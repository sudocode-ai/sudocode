/**
 * Metrics Dashboard Component
 * Phase 6 Task 6: Display project agent performance metrics
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';

interface DashboardMetrics {
  period: {
    start: string;
    end: string;
  };
  actions: {
    total_actions: number;
    by_type: Record<string, number>;
    by_status: Record<string, number>;
    success_rate: number;
    average_confidence: number;
    risk_distribution: {
      low: number;
      medium: number;
      high: number;
    };
  };
  time: {
    average_approval_time_seconds: number;
    average_execution_time_seconds: number;
    time_saved_hours: number;
    actions_per_day: number;
  };
  health: {
    agent_uptime_seconds: number;
    events_processed_total: number;
    events_per_minute: number;
    cache_hit_rate: number;
    error_rate: number;
    last_activity_ago_seconds: number;
  };
  trends: {
    success_rate: Array<{ timestamp: string; value: number }>;
    actions_per_day: Array<{ timestamp: string; value: number }>;
    approval_rate: Array<{ timestamp: string; value: number }>;
  };
}

interface ActionBreakdown {
  action_type: string;
  count: number;
  percentage: number;
}

interface Activity {
  timestamp: string;
  action_type: string;
  status: string;
  confidence_score: number | null;
  risk_level: string | null;
}

export function MetricsDashboard({ className = '' }: { className?: string }) {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [breakdown, setBreakdown] = useState<ActionBreakdown[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState(7);

  useEffect(() => {
    loadMetrics();
    // Refresh every 30 seconds
    const interval = setInterval(loadMetrics, 30000);
    return () => clearInterval(interval);
  }, [period]);

  const loadMetrics = async () => {
    try {
      setLoading(true);
      const [metricsRes, breakdownRes, activityRes] = await Promise.all([
        fetch(`/api/project-agent/metrics/dashboard?period=${period}`),
        fetch(`/api/project-agent/metrics/action-breakdown?period=${period}`),
        fetch(`/api/project-agent/metrics/activity?limit=20`),
      ]);

      if (!metricsRes.ok || !breakdownRes.ok || !activityRes.ok) {
        throw new Error('Failed to fetch metrics');
      }

      const metricsData = await metricsRes.json();
      const breakdownData = await breakdownRes.json();
      const activityData = await activityRes.json();

      setMetrics(metricsData.data);
      setBreakdown(breakdownData.data.breakdown);
      setActivity(activityData.data.activity);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load metrics');
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
    return `${Math.round(seconds / 86400)}d`;
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'completed':
        return 'bg-green-500';
      case 'failed':
        return 'bg-red-500';
      case 'approved':
        return 'bg-blue-500';
      case 'rejected':
        return 'bg-orange-500';
      case 'proposed':
        return 'bg-yellow-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getRiskColor = (risk: string | null): string => {
    switch (risk) {
      case 'low':
        return 'text-green-600 dark:text-green-400';
      case 'medium':
        return 'text-yellow-600 dark:text-yellow-400';
      case 'high':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-gray-600 dark:text-gray-400';
    }
  };

  const getHealthStatus = (health: DashboardMetrics['health']): {
    status: string;
    color: string;
  } => {
    if (health.error_rate > 20) return { status: 'Critical', color: 'text-red-600' };
    if (health.error_rate > 10) return { status: 'Warning', color: 'text-yellow-600' };
    if (health.cache_hit_rate < 50) return { status: 'Degraded', color: 'text-orange-600' };
    return { status: 'Healthy', color: 'text-green-600' };
  };

  if (loading && !metrics) {
    return (
      <div className={`space-y-4 ${className}`}>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`p-4 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg ${className}`}>
        <p className="text-red-800 dark:text-red-200">Error loading metrics: {error}</p>
        <button
          onClick={loadMetrics}
          className="mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!metrics) return null;

  const healthStatus = getHealthStatus(metrics.health);

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header with period selector */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Project Agent Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            Monitoring period:{' '}
            {new Date(metrics.period.start).toLocaleDateString()} -{' '}
            {new Date(metrics.period.end).toLocaleDateString()}
          </p>
        </div>
        <div className="flex gap-2">
          {[7, 14, 30].map((days) => (
            <button
              key={days}
              onClick={() => setPeriod(days)}
              className={`px-3 py-1 rounded ${
                period === days
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/80'
              }`}
            >
              {days}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Actions</CardDescription>
            <CardTitle className="text-3xl">{metrics.actions.total_actions}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {metrics.time.actions_per_day} per day average
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Success Rate</CardDescription>
            <CardTitle className="text-3xl">{metrics.actions.success_rate}%</CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={metrics.actions.success_rate} className="h-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Time Saved</CardDescription>
            <CardTitle className="text-3xl">{metrics.time.time_saved_hours}h</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Estimated automation benefit
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Agent Health</CardDescription>
            <CardTitle className={`text-2xl ${healthStatus.color}`}>
              {healthStatus.status}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Uptime: {formatDuration(metrics.health.agent_uptime_seconds)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs for detailed views */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="breakdown">Breakdown</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Confidence & Risk */}
            <Card>
              <CardHeader>
                <CardTitle>Confidence & Risk</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Average Confidence</span>
                    <span className="font-semibold">
                      {metrics.actions.average_confidence}%
                    </span>
                  </div>
                  <Progress value={metrics.actions.average_confidence} className="h-2" />
                </div>

                <div>
                  <p className="text-sm font-medium mb-2">Risk Distribution</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="text-green-600">
                        Low Risk
                      </Badge>
                      <span className="text-sm font-semibold">
                        {metrics.actions.risk_distribution.low}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="text-yellow-600">
                        Medium Risk
                      </Badge>
                      <span className="text-sm font-semibold">
                        {metrics.actions.risk_distribution.medium}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="text-red-600">
                        High Risk
                      </Badge>
                      <span className="text-sm font-semibold">
                        {metrics.actions.risk_distribution.high}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Action Status */}
            <Card>
              <CardHeader>
                <CardTitle>Action Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(metrics.actions.by_status).map(([status, count]) => {
                    const total = metrics.actions.total_actions;
                    const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
                    return (
                      <div key={status}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="capitalize">{status}</span>
                          <span className="font-semibold">
                            {count} ({percentage}%)
                          </span>
                        </div>
                        <Progress value={percentage} className="h-2" />
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="performance" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Timing Metrics */}
            <Card>
              <CardHeader>
                <CardTitle>Timing Metrics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground">Average Approval Time</p>
                  <p className="text-2xl font-bold">
                    {formatDuration(metrics.time.average_approval_time_seconds)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Average Execution Time</p>
                  <p className="text-2xl font-bold">
                    {formatDuration(metrics.time.average_execution_time_seconds)}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* System Health */}
            <Card>
              <CardHeader>
                <CardTitle>System Health</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-sm">Cache Hit Rate</span>
                  <span className="font-semibold">{metrics.health.cache_hit_rate}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Error Rate</span>
                  <span className="font-semibold">{metrics.health.error_rate}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Events/Minute</span>
                  <span className="font-semibold">{metrics.health.events_per_minute}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Last Activity</span>
                  <span className="font-semibold">
                    {formatDuration(metrics.health.last_activity_ago_seconds)} ago
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="breakdown">
          <Card>
            <CardHeader>
              <CardTitle>Action Type Breakdown</CardTitle>
              <CardDescription>Distribution of actions by type</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {breakdown.map((item) => (
                  <div key={item.action_type}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="capitalize">
                        {item.action_type.replace(/_/g, ' ')}
                      </span>
                      <span className="font-semibold">
                        {item.count} ({item.percentage}%)
                      </span>
                    </div>
                    <Progress value={item.percentage} className="h-2" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Last 20 actions</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {activity.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2 rounded-lg bg-muted/50 hover:bg-muted"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${getStatusColor(item.status)}`} />
                        <span className="text-sm font-medium capitalize">
                          {item.action_type.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground ml-4">
                        {new Date(item.timestamp).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {item.confidence_score !== null && (
                        <Badge variant="outline">{item.confidence_score}%</Badge>
                      )}
                      {item.risk_level && (
                        <Badge variant="outline" className={getRiskColor(item.risk_level)}>
                          {item.risk_level}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
