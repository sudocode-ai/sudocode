/**
 * Agent Router Service
 * Manages multiple concurrent agent executions and intelligently routes
 * user requests to minimize context switching
 */

import type Database from "better-sqlite3";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import type {
  AgentRequest,
  UserResponse,
  QueueStats,
  AgentRouterConfig,
  IssuePriority,
  RequestType,
  ResponseOption,
  RequestContext,
} from "./agent-router-types.js";
import { DEFAULT_ROUTER_CONFIG } from "./agent-router-types.js";
import { BatchingEngine, type RequestBatch } from "./batching-engine.js";

// Re-export for external use
export type { RequestBatch } from "./batching-engine.js";

export class AgentRouter extends EventEmitter {
  private db: Database.Database;
  private config: AgentRouterConfig;
  private cleanupInterval?: NodeJS.Timeout;
  private batchingEngine: BatchingEngine;

  constructor(db: Database.Database, config?: Partial<AgentRouterConfig>) {
    super();
    this.db = db;
    this.config = { ...DEFAULT_ROUTER_CONFIG, ...config };
    this.batchingEngine = new BatchingEngine({
      similarityThreshold: 0.7,
      minBatchSize: 2,
      batchTimeWindowMs: 30000, // 30 seconds
    });

    // Start cleanup interval for expired requests
    this.startCleanupInterval();
  }

  /**
   * Enqueue a new agent request
   */
  async enqueueRequest(params: {
    executionId: string;
    issueId: string;
    issuePriority?: IssuePriority;
    type: RequestType;
    message: string;
    context?: RequestContext;
    urgency?: 'blocking' | 'non-blocking';
    estimatedImpact?: number;
    batchingKey?: string;
    keywords?: string[];
    options?: ResponseOption[];
    defaultResponse?: string;
    expiresInSeconds?: number;
  }): Promise<AgentRequest> {
    const id = randomUUID();
    const createdAt = new Date();
    const expiresAt = params.expiresInSeconds
      ? new Date(Date.now() + params.expiresInSeconds * 1000)
      : new Date(Date.now() + this.config.requestTimeout * 1000);

    // Get issue priority from database if not provided
    let issuePriority = params.issuePriority || this.config.defaultPriority;
    if (!params.issuePriority) {
      const issue = this.db
        .prepare("SELECT priority FROM issues WHERE id = ?")
        .get(params.issueId) as { priority: number } | undefined;

      if (issue) {
        issuePriority = this.priorityNumberToString(issue.priority);
      }
    }

    // Generate pattern signature for similarity matching
    const patternSignature = this.generatePatternSignature({
      type: params.type,
      keywords: params.keywords || [],
      context: params.context,
    });

    const request: AgentRequest = {
      id,
      executionId: params.executionId,
      issueId: params.issueId,
      issuePriority,
      type: params.type,
      message: params.message,
      context: params.context,
      createdAt,
      expiresAt,
      batchingKey: params.batchingKey,
      keywords: params.keywords || [],
      urgency: params.urgency || 'blocking',
      estimatedImpact: params.estimatedImpact || 50,
      options: params.options,
      defaultResponse: params.defaultResponse,
      patternSignature,
      status: 'queued',
    };

    // Insert into database
    const stmt = this.db.prepare(`
      INSERT INTO agent_requests (
        id, execution_id, issue_id, type, message, context,
        issue_priority, urgency, estimated_impact, batching_key,
        keywords, pattern_signature, options, status, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      request.id,
      request.executionId,
      request.issueId,
      request.type,
      request.message,
      JSON.stringify(request.context || {}),
      request.issuePriority,
      request.urgency,
      request.estimatedImpact,
      request.batchingKey || null,
      JSON.stringify(request.keywords),
      request.patternSignature || null,
      JSON.stringify(request.options || []),
      request.status,
      request.createdAt.toISOString(),
      request.expiresAt?.toISOString() || null
    );

    // Emit event for real-time updates
    this.emit('request_queued', request);

    return request;
  }

  /**
   * Get all requests in queue, sorted by priority
   */
  getQueue(): AgentRequest[] {
    const rows = this.db
      .prepare(
        `
      SELECT * FROM agent_requests
      WHERE status IN ('queued', 'presented')
      ORDER BY created_at ASC
    `
      )
      .all() as any[];

    const requests = rows.map(this.rowToRequest);

    // Sort by calculated priority
    return requests.sort((a, b) => {
      const priorityA = this.calculatePriority(a);
      const priorityB = this.calculatePriority(b);
      return priorityB - priorityA; // Higher priority first
    });
  }

  /**
   * Get a specific request by ID
   */
  getRequest(requestId: string): AgentRequest | null {
    const row = this.db
      .prepare("SELECT * FROM agent_requests WHERE id = ?")
      .get(requestId) as any;

    return row ? this.rowToRequest(row) : null;
  }

  /**
   * Get all requests for an execution
   */
  getRequestsForExecution(executionId: string): AgentRequest[] {
    const rows = this.db
      .prepare(
        `
      SELECT * FROM agent_requests
      WHERE execution_id = ?
      ORDER BY created_at ASC
    `
      )
      .all(executionId) as any[];

    return rows.map(this.rowToRequest);
  }

  /**
   * Respond to a request
   */
  async respondToRequest(
    requestId: string,
    response: string,
    auto: boolean = false,
    patternId?: string
  ): Promise<UserResponse> {
    const request = this.getRequest(requestId);
    if (!request) {
      throw new Error(`Request ${requestId} not found`);
    }

    if (request.status === 'responded') {
      throw new Error(`Request ${requestId} already responded to`);
    }

    if (request.status === 'expired' || request.status === 'cancelled') {
      throw new Error(`Request ${requestId} is ${request.status}`);
    }

    const timestamp = new Date();

    // Update database
    const stmt = this.db.prepare(`
      UPDATE agent_requests
      SET status = 'responded',
          response_value = ?,
          response_timestamp = ?,
          response_auto = ?,
          response_pattern_id = ?,
          responded_at = ?
      WHERE id = ?
    `);

    stmt.run(
      response,
      timestamp.toISOString(),
      auto ? 1 : 0,
      patternId || null,
      timestamp.toISOString(),
      requestId
    );

    const userResponse: UserResponse = {
      requestId,
      value: response,
      timestamp,
      auto,
      patternId,
    };

    // Emit event
    this.emit('request_responded', request, userResponse);

    return userResponse;
  }

  /**
   * Cancel a request
   */
  async cancelRequest(requestId: string): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE agent_requests
      SET status = 'cancelled'
      WHERE id = ? AND status IN ('queued', 'presented')
    `);

    const result = stmt.run(requestId);

    if (result.changes > 0) {
      this.emit('request_cancelled', requestId);
    }
  }

  /**
   * Cancel all requests for an execution
   */
  async cancelRequestsForExecution(executionId: string): Promise<number> {
    const stmt = this.db.prepare(`
      UPDATE agent_requests
      SET status = 'cancelled'
      WHERE execution_id = ? AND status IN ('queued', 'presented')
    `);

    const result = stmt.run(executionId);
    return result.changes;
  }

  /**
   * Mark a request as presented to user
   */
  markAsPresented(requestId: string): void {
    const stmt = this.db.prepare(`
      UPDATE agent_requests
      SET status = 'presented', presented_at = ?
      WHERE id = ? AND status = 'queued'
    `);

    const result = stmt.run(new Date().toISOString(), requestId);

    if (result.changes > 0) {
      this.emit('request_presented', requestId);
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    const stats = this.db
      .prepare(
        `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
        SUM(CASE WHEN status = 'presented' THEN 1 ELSE 0 END) as presented,
        SUM(CASE WHEN status = 'responded' THEN 1 ELSE 0 END) as responded,
        SUM(CASE WHEN issue_priority = 'critical' THEN 1 ELSE 0 END) as critical,
        SUM(CASE WHEN issue_priority = 'high' THEN 1 ELSE 0 END) as high,
        SUM(CASE WHEN issue_priority = 'medium' THEN 1 ELSE 0 END) as medium,
        SUM(CASE WHEN issue_priority = 'low' THEN 1 ELSE 0 END) as low,
        AVG(JULIANDAY('now') - JULIANDAY(created_at)) * 86400000 as avg_wait
      FROM agent_requests
      WHERE status IN ('queued', 'presented')
    `
      )
      .get() as any;

    const oldestRow = this.db
      .prepare(
        `
      SELECT * FROM agent_requests
      WHERE status IN ('queued', 'presented')
      ORDER BY created_at ASC
      LIMIT 1
    `
      )
      .get() as any;

    return {
      total: stats.total || 0,
      queued: stats.queued || 0,
      presented: stats.presented || 0,
      responded: stats.responded || 0,
      byPriority: {
        critical: stats.critical || 0,
        high: stats.high || 0,
        medium: stats.medium || 0,
        low: stats.low || 0,
      },
      averageWaitTime: stats.avg_wait || 0,
      oldestRequest: oldestRow ? this.rowToRequest(oldestRow) : undefined,
    };
  }

  /**
   * Get batches of similar requests
   */
  getBatches(): RequestBatch[] {
    const queue = this.getQueue();
    return this.batchingEngine.findBatchable(queue);
  }

  /**
   * Extract common patterns from a batch
   */
  getBatchPatterns(batchId: string, requests: AgentRequest[]) {
    const batch: RequestBatch = {
      id: batchId,
      requests,
      similarityScore: 0,
      createdAt: new Date(),
    };
    return this.batchingEngine.extractCommonPatterns(batch);
  }

  /**
   * Respond to all requests in a batch with the same response
   */
  async respondToBatch(
    requestIds: string[],
    response: string,
    auto: boolean = false,
    patternId?: string
  ): Promise<UserResponse[]> {
    const responses: UserResponse[] = [];

    for (const requestId of requestIds) {
      try {
        const userResponse = await this.respondToRequest(
          requestId,
          response,
          auto,
          patternId
        );
        responses.push(userResponse);
      } catch (error) {
        // Log error but continue with other requests
        console.error(`Failed to respond to request ${requestId}:`, error);
      }
    }

    // Emit batch response event
    this.emit('batch_responded', requestIds, response);

    return responses;
  }

  /**
   * Clean up expired requests
   */
  private cleanupExpired(): void {
    const stmt = this.db.prepare(`
      UPDATE agent_requests
      SET status = 'expired'
      WHERE status IN ('queued', 'presented')
        AND expires_at IS NOT NULL
        AND datetime(expires_at) < datetime('now')
    `);

    const result = stmt.run();

    if (result.changes > 0) {
      this.emit('requests_expired', result.changes);
    }
  }

  /**
   * Start periodic cleanup of expired requests
   */
  private startCleanupInterval(): void {
    // Run cleanup every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired();
    }, 60000);
  }

  /**
   * Stop cleanup interval
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  /**
   * Calculate priority score for a request
   */
  private calculatePriority(request: AgentRequest): number {
    const weights = this.config.priorityWeights;
    let score = 0;

    // Issue priority (0-100)
    const priorityScore = this.priorityToScore(request.issuePriority);
    score += priorityScore * weights.issuePriority;

    // Urgency (0-100)
    const urgencyScore = request.urgency === 'blocking' ? 100 : 50;
    score += urgencyScore * weights.urgency;

    // Wait time (0-100, capped)
    const waitMinutes =
      (Date.now() - request.createdAt.getTime()) / 60000;
    const waitScore = Math.min(waitMinutes * 2, 100);
    score += waitScore * weights.waitTime;

    // Estimated impact (0-100)
    score += request.estimatedImpact * weights.impact;

    return score;
  }

  /**
   * Convert priority string to score
   */
  private priorityToScore(priority: IssuePriority): number {
    const map = {
      critical: 100,
      high: 75,
      medium: 50,
      low: 25,
    };
    return map[priority] || 50;
  }

  /**
   * Convert priority number (from database) to string
   */
  private priorityNumberToString(priority: number): IssuePriority {
    // Assuming database stores: 0=low, 1=medium, 2=high, 3=critical, 4=critical
    if (priority >= 4) return 'critical';
    if (priority >= 3) return 'high';
    if (priority >= 2) return 'medium';
    return 'low';
  }

  /**
   * Generate pattern signature for request matching
   */
  private generatePatternSignature(params: {
    type: RequestType;
    keywords: string[];
    context?: RequestContext;
  }): string {
    const normalized = {
      type: params.type,
      keywords: params.keywords.sort(),
      context: params.context?.codeArea || 'unknown',
    };
    return JSON.stringify(normalized);
  }

  /**
   * Convert database row to AgentRequest object
   */
  private rowToRequest(row: any): AgentRequest {
    return {
      id: row.id,
      executionId: row.execution_id,
      issueId: row.issue_id,
      issuePriority: row.issue_priority,
      type: row.type,
      message: row.message,
      context: row.context ? JSON.parse(row.context) : undefined,
      createdAt: new Date(row.created_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
      batchingKey: row.batching_key,
      keywords: row.keywords ? JSON.parse(row.keywords) : [],
      urgency: row.urgency,
      estimatedImpact: row.estimated_impact,
      options: row.options ? JSON.parse(row.options) : undefined,
      defaultResponse: row.default_response,
      patternSignature: row.pattern_signature,
      status: row.status,
      presentedAt: row.presented_at ? new Date(row.presented_at) : undefined,
      respondedAt: row.responded_at ? new Date(row.responded_at) : undefined,
      responseValue: row.response_value,
      responseAuto: row.response_auto === 1,
      responsePatternId: row.response_pattern_id,
    };
  }
}
