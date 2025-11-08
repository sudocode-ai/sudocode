/**
 * Progress Reporting Service
 * Phase 6: Generates scheduled reports on project status and health
 */

import type Database from "better-sqlite3";
import type { ProjectAgentAction, ProjectAgentExecution } from "@sudocode-ai/types";
import { SudocodeClient } from "@sudocode-ai/cli/dist/client.js";
import { getRunningProjectAgentExecution } from "./project-agent-db.js";
import * as fs from "fs";
import * as path from "path";

export interface ProjectReport {
  generated_at: string;
  period: {
    start: string;
    end: string;
  };
  summary: {
    specs: {
      total: number;
      active: number;
      archived: number;
      needs_attention: number;
    };
    issues: {
      total: number;
      ready: number;
      in_progress: number;
      blocked: number;
      completed: number;
      closed_this_period: number;
    };
    executions: {
      total_this_period: number;
      running: number;
      completed: number;
      failed: number;
      success_rate: number; // percentage
    };
    agent_activity: {
      actions_proposed: number;
      actions_approved: number;
      actions_rejected: number;
      approval_rate: number; // percentage
    };
  };
  progress: {
    issues_completed_this_period: number;
    specs_added_this_period: number;
    trend: "improving" | "stable" | "declining";
  };
  blockers: Array<{
    issue_id: string;
    title: string;
    blocked_by: string[];
    duration_days: number;
  }>;
  recommendations: Array<{
    type: "start_execution" | "review_spec" | "resolve_blocker" | "archive_issues";
    priority: "high" | "medium" | "low";
    description: string;
    target_id?: string;
  }>;
  health_score: number; // 0-100
}

/**
 * Progress Reporting Service
 */
export class ProgressReportingService {
  private db: Database.Database;
  private cliClient: SudocodeClient;
  private repoPath: string;

  constructor(db: Database.Database, repoPath: string) {
    this.db = db;
    this.repoPath = repoPath;
    this.cliClient = new SudocodeClient({
      workingDir: repoPath,
    });
  }

  /**
   * Generate a project progress report
   */
  async generateReport(options?: {
    periodDays?: number; // Default: 7 (last 7 days)
    format?: "json" | "markdown" | "html";
  }): Promise<ProjectReport> {
    const periodDays = options?.periodDays ?? 7;
    const now = new Date();
    const startDate = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);

    // Gather data
    const specs = await this.getSpecsData(startDate);
    const issues = await this.getIssuesData(startDate);
    const executions = await this.getExecutionsData(startDate);
    const agentActivity = await this.getAgentActivityData(startDate);
    const blockers = await this.getBlockersData();
    const recommendations = await this.generateRecommendations(specs, issues, executions);

    // Calculate health score
    const healthScore = this.calculateHealthScore({
      success_rate: executions.success_rate,
      approval_rate: agentActivity.approval_rate,
      blocked_count: issues.blocked,
      ready_count: issues.ready,
    });

    // Calculate trend
    const trend = this.calculateTrend(issues.closed_this_period, periodDays);

    const report: ProjectReport = {
      generated_at: now.toISOString(),
      period: {
        start: startDate.toISOString(),
        end: now.toISOString(),
      },
      summary: {
        specs,
        issues,
        executions,
        agent_activity: agentActivity,
      },
      progress: {
        issues_completed_this_period: issues.closed_this_period,
        specs_added_this_period: specs.active - specs.archived,
        trend,
      },
      blockers,
      recommendations,
      health_score: healthScore,
    };

    return report;
  }

  /**
   * Get specs data
   */
  private async getSpecsData(
    startDate: Date
  ): Promise<ProjectReport["summary"]["specs"]> {
    try {
      const allSpecs = await this.cliClient.exec(["spec", "list", "--format", "json"]);
      const specs = Array.isArray(allSpecs) ? allSpecs : [];

      const active = specs.filter((s: any) => !s.archived).length;
      const archived = specs.filter((s: any) => s.archived).length;

      // Count specs needing attention (with feedback)
      let needsAttention = 0;
      for (const spec of specs.filter((s: any) => !s.archived)) {
        try {
          const feedback = await this.cliClient.exec([
            "feedback",
            "list",
            "--spec-id",
            spec.id,
            "--format",
            "json",
          ]);
          if (Array.isArray(feedback) && feedback.length > 0) {
            needsAttention++;
          }
        } catch (err) {
          // Ignore errors for individual specs
        }
      }

      return {
        total: specs.length,
        active,
        archived,
        needs_attention: needsAttention,
      };
    } catch (error) {
      console.error("[progress-reporting] Failed to get specs data:", error);
      return { total: 0, active: 0, archived: 0, needs_attention: 0 };
    }
  }

  /**
   * Get issues data
   */
  private async getIssuesData(
    startDate: Date
  ): Promise<ProjectReport["summary"]["issues"]> {
    try {
      const allIssues = await this.cliClient.exec(["issue", "list", "--format", "json"]);
      const issues = Array.isArray(allIssues) ? allIssues : [];

      const ready = issues.filter((i: any) => i.status === "ready").length;
      const inProgress = issues.filter((i: any) => i.status === "in_progress").length;
      const blocked = issues.filter((i: any) => i.status === "blocked").length;
      const completed = issues.filter((i: any) => i.status === "completed").length;

      // Count issues closed in period
      const closedThisPeriod = issues.filter((i: any) => {
        if (!i.closed_at) return false;
        const closedDate = new Date(i.closed_at);
        return closedDate >= startDate;
      }).length;

      return {
        total: issues.length,
        ready,
        in_progress: inProgress,
        blocked,
        completed,
        closed_this_period: closedThisPeriod,
      };
    } catch (error) {
      console.error("[progress-reporting] Failed to get issues data:", error);
      return {
        total: 0,
        ready: 0,
        in_progress: 0,
        blocked: 0,
        completed: 0,
        closed_this_period: 0,
      };
    }
  }

  /**
   * Get executions data
   */
  private async getExecutionsData(
    startDate: Date
  ): Promise<ProjectReport["summary"]["executions"]> {
    try {
      const stmt = this.db.prepare(`
        SELECT status, COUNT(*) as count
        FROM executions
        WHERE created_at >= ?
        GROUP BY status
      `);

      const rows = stmt.all(startDate.toISOString()) as Array<{
        status: string;
        count: number;
      }>;

      let total = 0;
      let running = 0;
      let completed = 0;
      let failed = 0;

      for (const row of rows) {
        total += row.count;
        if (row.status === "running") running = row.count;
        else if (row.status === "completed") completed = row.count;
        else if (row.status === "failed") failed = row.count;
      }

      const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;

      return {
        total_this_period: total,
        running,
        completed,
        failed,
        success_rate: successRate,
      };
    } catch (error) {
      console.error("[progress-reporting] Failed to get executions data:", error);
      return {
        total_this_period: 0,
        running: 0,
        completed: 0,
        failed: 0,
        success_rate: 0,
      };
    }
  }

  /**
   * Get agent activity data
   */
  private async getAgentActivityData(
    startDate: Date
  ): Promise<ProjectReport["summary"]["agent_activity"]> {
    try {
      const stmt = this.db.prepare(`
        SELECT status, COUNT(*) as count
        FROM project_agent_actions
        WHERE created_at >= ?
        GROUP BY status
      `);

      const rows = stmt.all(startDate.toISOString()) as Array<{
        status: string;
        count: number;
      }>;

      let proposed = 0;
      let approved = 0;
      let rejected = 0;

      for (const row of rows) {
        if (row.status === "proposed") proposed += row.count;
        else if (row.status === "approved" || row.status === "completed") approved += row.count;
        else if (row.status === "rejected") rejected += row.count;
      }

      const total = approved + rejected;
      const approvalRate = total > 0 ? Math.round((approved / total) * 100) : 0;

      return {
        actions_proposed: proposed + approved + rejected,
        actions_approved: approved,
        actions_rejected: rejected,
        approval_rate: approvalRate,
      };
    } catch (error) {
      console.error("[progress-reporting] Failed to get agent activity:", error);
      return {
        actions_proposed: 0,
        actions_approved: 0,
        actions_rejected: 0,
        approval_rate: 0,
      };
    }
  }

  /**
   * Get blockers data
   */
  private async getBlockersData(): Promise<ProjectReport["blockers"]> {
    try {
      const blockedIssues = await this.cliClient.exec([
        "issue",
        "list",
        "--status",
        "blocked",
        "--format",
        "json",
      ]);

      if (!Array.isArray(blockedIssues)) {
        return [];
      }

      const blockers: ProjectReport["blockers"] = [];

      for (const issue of blockedIssues) {
        // Get relationships to find what blocks this issue
        try {
          const relationships = await this.cliClient.exec([
            "relationship",
            "list",
            "--to-id",
            issue.id,
            "--format",
            "json",
          ]);

          const blockingRelationships = Array.isArray(relationships)
            ? relationships.filter(
                (r: any) => r.relationship_type === "blocks" || r.relationship_type === "depends-on"
              )
            : [];

          const blockedBy = blockingRelationships.map((r: any) => r.from_id);

          // Calculate duration
          const updatedAt = new Date(issue.updated_at || issue.created_at);
          const now = new Date();
          const durationDays = Math.floor(
            (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24)
          );

          blockers.push({
            issue_id: issue.id,
            title: issue.title,
            blocked_by: blockedBy,
            duration_days: durationDays,
          });
        } catch (err) {
          // Skip this blocker if we can't get relationships
        }
      }

      return blockers;
    } catch (error) {
      console.error("[progress-reporting] Failed to get blockers:", error);
      return [];
    }
  }

  /**
   * Generate recommendations
   */
  private async generateRecommendations(
    specs: ProjectReport["summary"]["specs"],
    issues: ProjectReport["summary"]["issues"],
    executions: ProjectReport["summary"]["executions"]
  ): Promise<ProjectReport["recommendations"]> {
    const recommendations: ProjectReport["recommendations"] = [];

    // Recommend starting executions for ready issues
    if (issues.ready > 0 && executions.running < 3) {
      recommendations.push({
        type: "start_execution",
        priority: "high",
        description: `${issues.ready} issue(s) ready for execution. Consider starting work.`,
      });
    }

    // Recommend reviewing specs that need attention
    if (specs.needs_attention > 0) {
      recommendations.push({
        type: "review_spec",
        priority: "medium",
        description: `${specs.needs_attention} spec(s) have feedback requiring review.`,
      });
    }

    // Recommend resolving blockers if any exist
    const blockers = await this.getBlockersData();
    if (blockers.length > 0) {
      recommendations.push({
        type: "resolve_blocker",
        priority: "high",
        description: `${blockers.length} issue(s) are blocked. Review dependencies.`,
      });
    }

    // Recommend archiving old completed issues
    if (issues.completed > 20) {
      recommendations.push({
        type: "archive_issues",
        priority: "low",
        description: `${issues.completed} completed issues. Consider archiving old ones.`,
      });
    }

    return recommendations;
  }

  /**
   * Calculate health score (0-100)
   */
  private calculateHealthScore(metrics: {
    success_rate: number;
    approval_rate: number;
    blocked_count: number;
    ready_count: number;
  }): number {
    let score = 50; // Start at 50

    // Success rate contributes up to 25 points
    score += (metrics.success_rate / 100) * 25;

    // Approval rate contributes up to 15 points
    score += (metrics.approval_rate / 100) * 15;

    // Ready issues contribute positively (up to 10 points)
    score += Math.min(metrics.ready_count * 2, 10);

    // Blocked issues contribute negatively
    score -= metrics.blocked_count * 5;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Calculate trend
   */
  private calculateTrend(
    closedCount: number,
    periodDays: number
  ): "improving" | "stable" | "declining" {
    const avgPerDay = closedCount / periodDays;

    if (avgPerDay >= 1) return "improving";
    if (avgPerDay >= 0.5) return "stable";
    return "declining";
  }

  /**
   * Format report as markdown
   */
  formatAsMarkdown(report: ProjectReport): string {
    const healthEmoji = this.getHealthEmoji(report.health_score);
    const trendEmoji = this.getTrendEmoji(report.progress.trend);

    let md = `# Project Status Report\n\n`;
    md += `**Generated:** ${new Date(report.generated_at).toLocaleString()}\n`;
    md += `**Period:** ${new Date(report.period.start).toLocaleDateString()} - ${new Date(
      report.period.end
    ).toLocaleDateString()}\n`;
    md += `**Health Score:** ${healthEmoji} ${report.health_score}/100\n\n`;

    // Summary
    md += `## Summary\n\n`;
    md += `### Specs\n`;
    md += `- **Total:** ${report.summary.specs.total}\n`;
    md += `- **Active:** ${report.summary.specs.active}\n`;
    md += `- **Archived:** ${report.summary.specs.archived}\n`;
    md += `- **Needs Attention:** ${report.summary.specs.needs_attention}\n\n`;

    md += `### Issues\n`;
    md += `- **Total:** ${report.summary.issues.total}\n`;
    md += `- **Ready:** ${report.summary.issues.ready}\n`;
    md += `- **In Progress:** ${report.summary.issues.in_progress}\n`;
    md += `- **Blocked:** ${report.summary.issues.blocked}\n`;
    md += `- **Completed:** ${report.summary.issues.completed}\n`;
    md += `- **Closed This Period:** ${report.summary.issues.closed_this_period}\n\n`;

    md += `### Executions\n`;
    md += `- **Total This Period:** ${report.summary.executions.total_this_period}\n`;
    md += `- **Running:** ${report.summary.executions.running}\n`;
    md += `- **Completed:** ${report.summary.executions.completed}\n`;
    md += `- **Failed:** ${report.summary.executions.failed}\n`;
    md += `- **Success Rate:** ${report.summary.executions.success_rate}%\n\n`;

    md += `### Agent Activity\n`;
    md += `- **Actions Proposed:** ${report.summary.agent_activity.actions_proposed}\n`;
    md += `- **Actions Approved:** ${report.summary.agent_activity.actions_approved}\n`;
    md += `- **Actions Rejected:** ${report.summary.agent_activity.actions_rejected}\n`;
    md += `- **Approval Rate:** ${report.summary.agent_activity.approval_rate}%\n\n`;

    // Progress
    md += `## Progress ${trendEmoji}\n\n`;
    md += `- **Issues Completed:** ${report.progress.issues_completed_this_period}\n`;
    md += `- **Specs Added:** ${report.progress.specs_added_this_period}\n`;
    md += `- **Trend:** ${report.progress.trend}\n\n`;

    // Blockers
    if (report.blockers.length > 0) {
      md += `## Blockers ⚠️\n\n`;
      for (const blocker of report.blockers) {
        md += `- **${blocker.issue_id}:** ${blocker.title}\n`;
        md += `  - Blocked by: ${blocker.blocked_by.join(", ")}\n`;
        md += `  - Duration: ${blocker.duration_days} days\n`;
      }
      md += `\n`;
    }

    // Recommendations
    if (report.recommendations.length > 0) {
      md += `## Recommendations\n\n`;
      for (const rec of report.recommendations) {
        const priorityIcon =
          rec.priority === "high" ? "🔴" : rec.priority === "medium" ? "🟡" : "🟢";
        md += `${priorityIcon} **${rec.type}** (${rec.priority} priority)\n`;
        md += `   ${rec.description}\n\n`;
      }
    }

    return md;
  }

  /**
   * Save report to file
   */
  async saveReport(
    report: ProjectReport,
    format: "json" | "markdown" = "markdown"
  ): Promise<string> {
    const reportsDir = path.join(this.repoPath, ".sudocode", "reports");

    // Create reports directory if it doesn't exist
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const timestamp = new Date(report.generated_at).toISOString().split("T")[0];
    const filename = `project-report-${timestamp}.${format === "json" ? "json" : "md"}`;
    const filepath = path.join(reportsDir, filename);

    const content = format === "json" ? JSON.stringify(report, null, 2) : this.formatAsMarkdown(report);

    fs.writeFileSync(filepath, content, "utf-8");

    console.log(`[progress-reporting] Report saved to ${filepath}`);
    return filepath;
  }

  /**
   * Get health emoji
   */
  private getHealthEmoji(score: number): string {
    if (score >= 80) return "🟢";
    if (score >= 60) return "🟡";
    return "🔴";
  }

  /**
   * Get trend emoji
   */
  private getTrendEmoji(trend: string): string {
    if (trend === "improving") return "📈";
    if (trend === "stable") return "➡️";
    return "📉";
  }
}

/**
 * Get global progress reporting service instance
 */
let progressReportingService: ProgressReportingService | null = null;

export function getProgressReportingService(
  db: Database.Database,
  repoPath: string
): ProgressReportingService {
  if (!progressReportingService) {
    progressReportingService = new ProgressReportingService(db, repoPath);
  }
  return progressReportingService;
}
