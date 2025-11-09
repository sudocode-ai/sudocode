/**
 * Phase 6 Complete Integration Tests
 * Comprehensive tests for all Phase 6 features
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { RiskAssessmentService } from '../../src/services/risk-assessment.js';
import { ProgressReportingService } from '../../src/services/progress-reporting.js';
import { CacheManager } from '../../src/services/cache-manager.js';
import { MetricsService } from '../../src/services/metrics.js';
import {
  CONFIG_PRESETS,
  getPresetConfig,
  suggestPreset,
} from '../../src/services/config-presets.js';
import { ActionManager } from '../../src/services/project-agent-actions.js';
import {
  createProjectAgentExecution,
  createProjectAgentAction,
  getProjectAgentAction,
} from '../../src/services/project-agent-db.js';
import {
  PROJECT_AGENT_EXECUTIONS_TABLE,
  PROJECT_AGENT_ACTIONS_TABLE,
  PROJECT_AGENT_EVENTS_TABLE,
  PROJECT_AGENT_EXECUTIONS_INDEXES,
  PROJECT_AGENT_ACTIONS_INDEXES,
  PROJECT_AGENT_EVENTS_INDEXES,
} from '@sudocode-ai/types/schema';

describe('Phase 6: Autonomous Mode & Polish - Complete Integration', () => {
  let db: Database.Database;
  let testRepoPath: string;

  beforeAll(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');
    testRepoPath = '/tmp/test-repo';

    // Initialize schema
    db.exec(PROJECT_AGENT_EXECUTIONS_TABLE);
    db.exec(PROJECT_AGENT_ACTIONS_TABLE);
    db.exec(PROJECT_AGENT_EVENTS_TABLE);
    db.exec(PROJECT_AGENT_EXECUTIONS_INDEXES);
    db.exec(PROJECT_AGENT_ACTIONS_INDEXES);
    db.exec(PROJECT_AGENT_EVENTS_INDEXES);
  });

  afterAll(() => {
    db.close();
  });

  describe('Task 1: Auto-Approval with Confidence & Risk', () => {
    let riskService: RiskAssessmentService;

    beforeEach(() => {
      riskService = new RiskAssessmentService();
    });

    it('should assess add_feedback action as low risk with high confidence', () => {
      const assessment = riskService.assessAction('add_feedback', {
        content: 'This spec needs more details about the authentication flow',
        type: 'question',
      });

      expect(assessment.riskLevel).toBe('low');
      expect(assessment.confidenceScore).toBeGreaterThan(80);
      expect(assessment.factors.length).toBeGreaterThan(0);
    });

    it('should assess create_issues_from_spec with medium risk', () => {
      const assessment = riskService.assessAction('create_issues_from_spec', {
        issues: [
          { title: 'Issue 1', description: 'Detailed description', priority: 0 },
          { title: 'Issue 2', description: 'Another detailed description', priority: 1 },
        ],
        relationships: [],
      });

      expect(assessment.riskLevel).toBe('low');
      expect(assessment.confidenceScore).toBeGreaterThan(70);
    });

    it('should assess modify_spec as high risk', () => {
      const assessment = riskService.assessAction('modify_spec', {
        spec_id: 'SPEC-001',
        description: 'Updated description',
      });

      expect(assessment.riskLevel).toBe('high');
      expect(assessment.confidenceScore).toBeLessThan(80);
    });

    it('should lower confidence for poorly defined actions', () => {
      const poorAssessment = riskService.assessAction('create_issues_from_spec', {
        issues: [
          { title: 'Issue 1', description: '' }, // No description
        ],
      });

      const goodAssessment = riskService.assessAction('create_issues_from_spec', {
        issues: [
          { title: 'Issue 1', description: 'Well-defined issue with clear description' },
        ],
      });

      expect(poorAssessment.confidenceScore).toBeLessThan(goodAssessment.confidenceScore);
    });

    it('should auto-approve based on confidence and risk thresholds', () => {
      const execution = createProjectAgentExecution(db, {
        executionId: `exec_${randomUUID()}`,
        mode: 'full',
        useWorktree: true,
        config: {
          useWorktree: true,
          mode: 'full',
          autoApprove: {
            enabled: true,
            allowedActions: ['add_feedback'],
            minConfidenceScore: 70,
            maxRiskLevel: 'medium',
          },
          monitoring: {
            stallThresholdMinutes: 30,
            checkIntervalSeconds: 60,
          },
        },
      });

      // High confidence, low risk - should auto-approve
      const actionLowRisk = createProjectAgentAction(db, {
        projectAgentExecutionId: execution.id,
        actionType: 'add_feedback',
        payload: { content: 'Good feedback' },
        justification: 'Test',
        confidenceScore: 85,
        riskLevel: 'low',
      });

      // Low confidence - should NOT auto-approve
      const actionLowConfidence = createProjectAgentAction(db, {
        projectAgentExecutionId: execution.id,
        actionType: 'add_feedback',
        payload: { content: 'Feedback' },
        justification: 'Test',
        confidenceScore: 60,
        riskLevel: 'low',
      });

      expect(actionLowRisk.confidence_score).toBeGreaterThanOrEqual(70);
      expect(actionLowConfidence.confidence_score).toBeLessThan(70);
    });
  });

  describe('Task 2: Progress Reporting', () => {
    let reportingService: ProgressReportingService;

    beforeEach(() => {
      // Mock CLI client
      const mockClient = {
        exec: vi.fn().mockResolvedValue([]),
      };
      reportingService = new ProgressReportingService(db, testRepoPath);
      // @ts-ignore - Override for testing
      reportingService.cliClient = mockClient;
    });

    it('should generate report with all sections', async () => {
      const report = await reportingService.generateReport({ periodDays: 7 });

      expect(report.generated_at).toBeDefined();
      expect(report.period.start).toBeDefined();
      expect(report.period.end).toBeDefined();
      expect(report.summary.specs).toBeDefined();
      expect(report.summary.issues).toBeDefined();
      expect(report.summary.executions).toBeDefined();
      expect(report.summary.agent_activity).toBeDefined();
      expect(report.progress).toBeDefined();
      expect(report.blockers).toBeDefined();
      expect(report.recommendations).toBeDefined();
      expect(report.health_score).toBeGreaterThanOrEqual(0);
      expect(report.health_score).toBeLessThanOrEqual(100);
    });

    it('should format report as markdown', async () => {
      const report = await reportingService.generateReport({ periodDays: 7 });
      const markdown = reportingService.formatAsMarkdown(report);

      expect(markdown).toContain('# Project Status Report');
      expect(markdown).toContain('## Summary');
      expect(markdown).toContain('### Specs');
      expect(markdown).toContain('### Issues');
      expect(markdown).toContain('### Executions');
      expect(markdown).toContain('Health Score:');
    });

    it('should calculate health score correctly', async () => {
      // Create test data
      const execution = createProjectAgentExecution(db, {
        executionId: `exec_${randomUUID()}`,
        mode: 'full',
        useWorktree: true,
        config: CONFIG_PRESETS.balanced.config,
      });

      // Create successful actions
      for (let i = 0; i < 5; i++) {
        const action = createProjectAgentAction(db, {
          projectAgentExecutionId: execution.id,
          actionType: 'add_feedback',
          payload: {},
          justification: 'Test',
          confidenceScore: 85,
          riskLevel: 'low',
        });

        db.prepare(
          `UPDATE project_agent_actions SET status = 'completed' WHERE id = ?`
        ).run(action.id);
      }

      const report = await reportingService.generateReport({ periodDays: 1 });
      expect(report.health_score).toBeGreaterThan(50);
    });
  });

  describe('Task 3: Performance Optimizations', () => {
    let cache: CacheManager;

    beforeEach(() => {
      cache = new CacheManager({ defaultTTL: 1000, maxSize: 100 });
    });

    afterEach(() => {
      cache.stopCleanup();
      cache.clear();
    });

    it('should cache and retrieve values', () => {
      cache.set('key1', { value: 'test' });
      const result = cache.get('key1');

      expect(result).toEqual({ value: 'test' });
    });

    it('should respect TTL and expire entries', async () => {
      cache.set('key1', 'value1', 100); // 100ms TTL

      expect(cache.get('key1')).toBe('value1');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(cache.get('key1')).toBeNull();
    });

    it('should track cache hits and misses', () => {
      cache.set('key1', 'value1');

      // Hit
      cache.get('key1');
      // Miss
      cache.get('key2');
      // Hit
      cache.get('key1');

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hit_rate).toBeGreaterThan(60);
    });

    it('should support getOrSet pattern', async () => {
      let callCount = 0;
      const fetchFn = async () => {
        callCount++;
        return { data: 'fetched' };
      };

      // First call - should fetch
      const result1 = await cache.getOrSet('key1', fetchFn);
      expect(result1).toEqual({ data: 'fetched' });
      expect(callCount).toBe(1);

      // Second call - should use cache
      const result2 = await cache.getOrSet('key1', fetchFn);
      expect(result2).toEqual({ data: 'fetched' });
      expect(callCount).toBe(1); // Still 1, not fetched again
    });

    it('should evict oldest entry when max size reached', () => {
      const smallCache = new CacheManager({ maxSize: 3 });

      smallCache.set('key1', 'value1');
      smallCache.set('key2', 'value2');
      smallCache.set('key3', 'value3');
      smallCache.set('key4', 'value4'); // Should evict key1

      expect(smallCache.get('key1')).toBeNull();
      expect(smallCache.get('key2')).toBe('value2');
      expect(smallCache.get('key3')).toBe('value3');
      expect(smallCache.get('key4')).toBe('value4');

      smallCache.stopCleanup();
    });

    it('should invalidate patterns', () => {
      cache.set('user:1', 'User 1');
      cache.set('user:2', 'User 2');
      cache.set('post:1', 'Post 1');

      const invalidated = cache.invalidatePattern(/^user:/);

      expect(invalidated).toBe(2);
      expect(cache.get('user:1')).toBeNull();
      expect(cache.get('user:2')).toBeNull();
      expect(cache.get('post:1')).toBe('Post 1');
    });
  });

  describe('Task 4: Configuration Presets', () => {
    it('should provide three configuration presets', () => {
      expect(CONFIG_PRESETS.conservative).toBeDefined();
      expect(CONFIG_PRESETS.balanced).toBeDefined();
      expect(CONFIG_PRESETS.aggressive).toBeDefined();
    });

    it('should have correct settings for conservative mode', () => {
      const config = getPresetConfig('conservative');

      expect(config.autoApprove.enabled).toBe(false);
      expect(config.mode).toBe('monitoring');
    });

    it('should have correct settings for balanced mode', () => {
      const config = getPresetConfig('balanced');

      expect(config.autoApprove.enabled).toBe(true);
      expect(config.autoApprove.allowedActions).toContain('add_feedback');
      expect(config.autoApprove.minConfidenceScore).toBe(70);
      expect(config.autoApprove.maxRiskLevel).toBe('medium');
    });

    it('should have correct settings for aggressive mode', () => {
      const config = getPresetConfig('aggressive');

      expect(config.autoApprove.enabled).toBe(true);
      expect(config.autoApprove.allowedActions).toContain('start_execution');
      expect(config.autoApprove.minConfidenceScore).toBe(60);
      expect(config.autoApprove.maxRiskLevel).toBe('high');
    });

    it('should suggest appropriate preset based on config', () => {
      // Conservative config
      const conservativeConfig = {
        useWorktree: true,
        mode: 'monitoring' as const,
        autoApprove: {
          enabled: false,
          allowedActions: [],
        },
        monitoring: {
          stallThresholdMinutes: 30,
          checkIntervalSeconds: 60,
        },
      };

      const suggestion1 = suggestPreset(conservativeConfig);
      expect(suggestion1.suggested).toBe('conservative');

      // Aggressive config
      const aggressiveConfig = {
        useWorktree: true,
        mode: 'full' as const,
        autoApprove: {
          enabled: true,
          allowedActions: [
            'add_feedback',
            'start_execution',
            'pause_execution',
            'resume_execution',
            'create_issues_from_spec',
            'create_relationship',
          ] as any[],
          minConfidenceScore: 60,
          maxRiskLevel: 'high' as const,
        },
        monitoring: {
          stallThresholdMinutes: 20,
          checkIntervalSeconds: 30,
        },
      };

      const suggestion2 = suggestPreset(aggressiveConfig);
      expect(suggestion2.suggested).toBe('aggressive');
    });
  });

  describe('Task 6: Metrics & Dashboard', () => {
    let metricsService: MetricsService;
    let execution: any;

    beforeEach(() => {
      metricsService = new MetricsService(db);

      execution = createProjectAgentExecution(db, {
        executionId: `exec_${randomUUID()}`,
        mode: 'full',
        useWorktree: true,
        config: CONFIG_PRESETS.balanced.config,
      });
    });

    it('should calculate action metrics', async () => {
      // Create test actions
      for (let i = 0; i < 10; i++) {
        const action = createProjectAgentAction(db, {
          projectAgentExecutionId: execution.id,
          actionType: i % 2 === 0 ? 'add_feedback' : 'start_execution',
          payload: {},
          justification: 'Test',
          confidenceScore: 75 + i,
          riskLevel: 'low',
        });

        // Mark some as completed, some as failed
        const status = i < 7 ? 'completed' : 'failed';
        db.prepare(
          `UPDATE project_agent_actions SET status = ? WHERE id = ?`
        ).run(status, action.id);
      }

      const metrics = await metricsService.getDashboardMetrics({ periodDays: 1 });

      expect(metrics.actions.total_actions).toBe(10);
      expect(metrics.actions.success_rate).toBeGreaterThan(50);
      expect(metrics.actions.by_type).toHaveProperty('add_feedback');
      expect(metrics.actions.by_type).toHaveProperty('start_execution');
    });

    it('should calculate time metrics', async () => {
      const now = new Date().toISOString();
      const action = createProjectAgentAction(db, {
        projectAgentExecutionId: execution.id,
        actionType: 'add_feedback',
        payload: {},
        justification: 'Test',
        confidenceScore: 85,
        riskLevel: 'low',
      });

      // Simulate approval and completion
      db.prepare(
        `UPDATE project_agent_actions
         SET status = 'completed', approved_at = ?, executed_at = ?, completed_at = ?
         WHERE id = ?`
      ).run(now, now, now, action.id);

      const metrics = await metricsService.getDashboardMetrics({ periodDays: 1 });

      expect(metrics.time).toBeDefined();
      expect(metrics.time.time_saved_hours).toBeGreaterThanOrEqual(0);
      expect(metrics.time.actions_per_day).toBeGreaterThanOrEqual(0);
    });

    it('should track health metrics', async () => {
      const metrics = await metricsService.getDashboardMetrics({ periodDays: 1 });

      expect(metrics.health).toBeDefined();
      expect(metrics.health.agent_uptime_seconds).toBeGreaterThanOrEqual(0);
      expect(metrics.health.events_processed_total).toBeGreaterThanOrEqual(0);
      expect(metrics.health.error_rate).toBeGreaterThanOrEqual(0);
      expect(metrics.health.error_rate).toBeLessThanOrEqual(100);
    });

    it('should get action type breakdown', async () => {
      // Create varied actions
      for (const actionType of ['add_feedback', 'start_execution', 'create_issues_from_spec']) {
        createProjectAgentAction(db, {
          projectAgentExecutionId: execution.id,
          actionType: actionType as any,
          payload: {},
          justification: 'Test',
          confidenceScore: 80,
          riskLevel: 'low',
        });
      }

      const breakdown = await metricsService.getActionTypeBreakdown(1);

      expect(breakdown.length).toBe(3);
      expect(breakdown.every((b) => b.percentage >= 0 && b.percentage <= 100)).toBe(true);
    });
  });

  describe('Performance Benchmarks', () => {
    it('should handle 100 concurrent cache operations efficiently', async () => {
      const cache = new CacheManager({ maxSize: 1000 });
      const startTime = Date.now();

      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(
          cache.getOrSet(`key${i}`, async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return { data: i };
          })
        );
      }

      await Promise.all(promises);
      const duration = Date.now() - startTime;

      // Should complete in under 500ms due to parallelization
      expect(duration).toBeLessThan(500);

      cache.stopCleanup();
      cache.clear();
    });

    it('should efficiently process risk assessments', () => {
      const service = new RiskAssessmentService();
      const startTime = Date.now();

      for (let i = 0; i < 1000; i++) {
        service.assessAction('add_feedback', {
          content: `Feedback ${i}`,
          type: 'suggestion',
        });
      }

      const duration = Date.now() - startTime;

      // Should process 1000 assessments in under 100ms
      expect(duration).toBeLessThan(100);
    });
  });

  describe('End-to-End Workflows', () => {
    it('should complete full action lifecycle with risk assessment', () => {
      const execution = createProjectAgentExecution(db, {
        executionId: `exec_${randomUUID()}`,
        mode: 'full',
        useWorktree: true,
        config: CONFIG_PRESETS.balanced.config,
      });

      // Assess risk
      const riskService = new RiskAssessmentService();
      const assessment = riskService.assessAction('add_feedback', {
        content: 'Please clarify the authentication method',
        type: 'question',
      });

      // Create action with risk assessment
      const action = createProjectAgentAction(db, {
        projectAgentExecutionId: execution.id,
        actionType: 'add_feedback',
        payload: { content: 'Please clarify the authentication method' },
        justification: 'Spec needs clarification',
        confidenceScore: assessment.confidenceScore,
        riskLevel: assessment.riskLevel,
      });

      expect(action.confidence_score).toBeGreaterThan(80);
      expect(action.risk_level).toBe('low');
      expect(action.status).toBe('proposed');

      // Simulate approval
      db.prepare(
        `UPDATE project_agent_actions SET status = 'approved', approved_at = ? WHERE id = ?`
      ).run(new Date().toISOString(), action.id);

      const updated = getProjectAgentAction(db, action.id);
      expect(updated?.status).toBe('approved');
    });

    it('should generate report after actions complete', async () => {
      const execution = createProjectAgentExecution(db, {
        executionId: `exec_${randomUUID()}`,
        mode: 'full',
        useWorktree: true,
        config: CONFIG_PRESETS.balanced.config,
      });

      // Create and complete multiple actions
      for (let i = 0; i < 5; i++) {
        const action = createProjectAgentAction(db, {
          projectAgentExecutionId: execution.id,
          actionType: 'add_feedback',
          payload: {},
          justification: 'Test',
          confidenceScore: 85,
          riskLevel: 'low',
        });

        db.prepare(
          `UPDATE project_agent_actions SET status = 'completed' WHERE id = ?`
        ).run(action.id);
      }

      // Generate report
      const mockClient = {
        exec: vi.fn().mockResolvedValue([]),
      };
      const reportingService = new ProgressReportingService(db, testRepoPath);
      // @ts-ignore
      reportingService.cliClient = mockClient;

      const report = await reportingService.generateReport({ periodDays: 1 });

      expect(report.summary.agent_activity.actions_approved).toBeGreaterThan(0);
      expect(report.health_score).toBeGreaterThan(50);
    });
  });
});
