/**
 * Pattern Matcher Service
 * Learns from user responses to agent requests and builds patterns for auto-response
 */

import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { createHash } from "crypto";
import type { AgentRequest, UserResponse, RequestType } from "./agent-router-types.js";

export interface Pattern {
  id: string;
  signature: string;

  // Pattern characteristics
  requestType: RequestType;
  keywords: string[];
  contextPatterns: string[];

  // Statistics
  totalOccurrences: number;
  confidenceScore: number;
  lastSeen: Date;

  // Auto-response
  suggestedResponse: string | null;
  autoResponseEnabled: boolean;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

export interface PatternResponse {
  id: string;
  patternId: string;
  responseValue: string;
  timestamp: Date;
  userConfidence: "certain" | "uncertain";
  wasOverridden: boolean;
}

export class PatternMatcher {
  private db: Database.Database;
  private minOccurrencesForAutoResponse: number;
  private minConfidenceForAutoResponse: number;

  constructor(
    db: Database.Database,
    config?: {
      minOccurrencesForAutoResponse?: number;
      minConfidenceForAutoResponse?: number;
    }
  ) {
    this.db = db;
    this.minOccurrencesForAutoResponse = config?.minOccurrencesForAutoResponse || 5;
    this.minConfidenceForAutoResponse = config?.minConfidenceForAutoResponse || 90;
  }

  /**
   * Find a matching pattern for a request
   */
  async findPattern(request: AgentRequest): Promise<Pattern | null> {
    const signature = this.generateSignature(request);

    // Try exact signature match first
    let row = this.db
      .prepare("SELECT * FROM agent_patterns WHERE signature = ?")
      .get(signature) as any;

    if (row) {
      return this.rowToPattern(row);
    }

    // Try fuzzy match based on keywords and type
    const candidates = this.db
      .prepare(
        `SELECT * FROM agent_patterns
         WHERE request_type = ?
         ORDER BY confidence_score DESC, last_seen DESC
         LIMIT 10`
      )
      .all(request.type) as any[];

    // Calculate similarity with each candidate
    for (const candidate of candidates) {
      const pattern = this.rowToPattern(candidate);
      const similarity = this.calculateRequestPatternSimilarity(request, pattern);

      if (similarity > 0.8) {
        return pattern;
      }
    }

    return null;
  }

  /**
   * Learn from a user response
   */
  async learn(request: AgentRequest, response: UserResponse): Promise<void> {
    const signature = this.generateSignature(request);

    // Get or create pattern
    let pattern = await this.findPattern(request);

    if (!pattern) {
      // Create new pattern
      pattern = {
        id: randomUUID(),
        signature,
        requestType: request.type,
        keywords: request.keywords,
        contextPatterns: this.extractContextPatterns(request),
        totalOccurrences: 0,
        confidenceScore: 0,
        lastSeen: new Date(),
        suggestedResponse: null,
        autoResponseEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      this.db
        .prepare(
          `INSERT INTO agent_patterns (
            id, signature, request_type, keywords, context_patterns,
            total_occurrences, confidence_score, last_seen,
            suggested_response, auto_response_enabled, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          pattern.id,
          pattern.signature,
          pattern.requestType,
          JSON.stringify(pattern.keywords),
          JSON.stringify(pattern.contextPatterns),
          pattern.totalOccurrences,
          pattern.confidenceScore,
          pattern.lastSeen.toISOString(),
          pattern.suggestedResponse,
          pattern.autoResponseEnabled ? 1 : 0,
          pattern.createdAt.toISOString(),
          pattern.updatedAt.toISOString()
        );
    }

    // Add response record
    const patternResponse: PatternResponse = {
      id: randomUUID(),
      patternId: pattern.id,
      responseValue: response.value,
      timestamp: response.timestamp,
      userConfidence: this.inferUserConfidence(request, response),
      wasOverridden: false,
    };

    this.db
      .prepare(
        `INSERT INTO agent_pattern_responses (
          id, pattern_id, response_value, timestamp, user_confidence, was_overridden
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        patternResponse.id,
        patternResponse.patternId,
        patternResponse.responseValue,
        patternResponse.timestamp.toISOString(),
        patternResponse.userConfidence,
        patternResponse.wasOverridden ? 1 : 0
      );

    // Update pattern statistics
    await this.updatePatternStatistics(pattern.id);
  }

  /**
   * Get all responses for a pattern
   */
  getPatternResponses(patternId: string): PatternResponse[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_pattern_responses
         WHERE pattern_id = ?
         ORDER BY timestamp DESC`
      )
      .all(patternId) as any[];

    return rows.map(this.rowToPatternResponse);
  }

  /**
   * Get all patterns
   */
  getAllPatterns(options?: {
    autoResponseOnly?: boolean;
    orderBy?: "confidence" | "occurrences" | "recent";
    limit?: number;
  }): Pattern[] {
    let query = "SELECT * FROM agent_patterns WHERE 1=1";

    if (options?.autoResponseOnly) {
      query += " AND auto_response_enabled = 1";
    }

    // Order by
    if (options?.orderBy === "confidence") {
      query += " ORDER BY confidence_score DESC";
    } else if (options?.orderBy === "occurrences") {
      query += " ORDER BY total_occurrences DESC";
    } else if (options?.orderBy === "recent") {
      query += " ORDER BY last_seen DESC";
    }

    if (options?.limit) {
      query += ` LIMIT ${options.limit}`;
    }

    const rows = this.db.prepare(query).all() as any[];
    return rows.map(this.rowToPattern);
  }

  /**
   * Toggle auto-response for a pattern
   */
  async setAutoResponse(patternId: string, enabled: boolean): Promise<void> {
    this.db
      .prepare(
        `UPDATE agent_patterns
         SET auto_response_enabled = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(enabled ? 1 : 0, new Date().toISOString(), patternId);
  }

  /**
   * Delete a pattern
   */
  async deletePattern(patternId: string): Promise<void> {
    this.db.prepare("DELETE FROM agent_patterns WHERE id = ?").run(patternId);
  }

  /**
   * Mark a response as overridden (user manually changed auto-response)
   */
  async markResponseAsOverridden(responseId: string): Promise<void> {
    this.db
      .prepare("UPDATE agent_pattern_responses SET was_overridden = 1 WHERE id = ?")
      .run(responseId);

    // Recalculate pattern confidence
    const response = this.db
      .prepare("SELECT pattern_id FROM agent_pattern_responses WHERE id = ?")
      .get(responseId) as any;

    if (response) {
      await this.updatePatternStatistics(response.pattern_id);
    }
  }

  /**
   * Update pattern statistics based on responses
   */
  private async updatePatternStatistics(patternId: string): Promise<void> {
    const responses = this.getPatternResponses(patternId);

    if (responses.length === 0) {
      return;
    }

    // Calculate consensus response
    const responseCounts = new Map<string, number>();
    for (const r of responses) {
      responseCounts.set(r.responseValue, (responseCounts.get(r.responseValue) || 0) + 1);
    }

    const sortedResponses = Array.from(responseCounts.entries()).sort((a, b) => b[1] - a[1]);
    const suggestedResponse = sortedResponses[0][0];
    const consensusCount = sortedResponses[0][1];

    // Calculate confidence score
    const confidence = this.calculateConfidence(responses, consensusCount);

    // Determine if auto-response should be enabled
    const autoResponseEnabled =
      confidence >= this.minConfidenceForAutoResponse &&
      responses.length >= this.minOccurrencesForAutoResponse;

    // Update pattern
    this.db
      .prepare(
        `UPDATE agent_patterns
         SET total_occurrences = ?,
             confidence_score = ?,
             suggested_response = ?,
             auto_response_enabled = ?,
             last_seen = ?,
             updated_at = ?
         WHERE id = ?`
      )
      .run(
        responses.length,
        confidence,
        suggestedResponse,
        autoResponseEnabled ? 1 : 0,
        new Date().toISOString(),
        new Date().toISOString(),
        patternId
      );
  }

  /**
   * Calculate confidence score for a pattern
   */
  private calculateConfidence(
    responses: PatternResponse[],
    consensusCount: number
  ): number {
    if (responses.length < 2) {
      return 0;
    }

    // Base consensus score (0-100)
    const consensus = (consensusCount / responses.length) * 100;

    // Recency factor - weight recent responses more heavily
    const recencyFactor = this.calculateRecencyFactor(responses);

    // User confidence factor - weight "certain" responses higher
    const certainCount = responses.filter((r) => r.userConfidence === "certain").length;
    const userConfidenceFactor = certainCount / responses.length;

    // Override penalty - reduce confidence if responses were overridden
    const overrideCount = responses.filter((r) => r.wasOverridden).length;
    const overridePenalty = Math.max(0, 1 - overrideCount / responses.length);

    // Combine factors
    const score = consensus * recencyFactor * (1 + userConfidenceFactor * 0.2) * overridePenalty;

    return Math.min(100, Math.max(0, score));
  }

  /**
   * Calculate recency factor (recent responses weighted more)
   */
  private calculateRecencyFactor(responses: PatternResponse[]): number {
    if (responses.length < 3) {
      return 1;
    }

    // Look at the 5 most recent responses
    const recent = responses.slice(0, 5);
    const responseCounts = new Map<string, number>();

    for (const r of recent) {
      responseCounts.set(r.responseValue, (responseCounts.get(r.responseValue) || 0) + 1);
    }

    const maxCount = Math.max(...responseCounts.values());
    return maxCount / recent.length;
  }

  /**
   * Infer user confidence from response time
   */
  private inferUserConfidence(
    request: AgentRequest,
    response: UserResponse
  ): "certain" | "uncertain" {
    const responseTimeMs = response.timestamp.getTime() - request.createdAt.getTime();

    // Fast response (< 5 seconds) indicates certainty
    // Slow response (> 5 seconds) indicates deliberation/uncertainty
    return responseTimeMs < 5000 ? "certain" : "uncertain";
  }

  /**
   * Generate signature for a request
   */
  private generateSignature(request: AgentRequest): string {
    const normalized = {
      type: request.type,
      keywords: request.keywords.sort(),
      context: request.context?.codeArea || "unknown",
    };

    const hash = createHash("sha256");
    hash.update(JSON.stringify(normalized));
    return hash.digest("hex");
  }

  /**
   * Extract context patterns from a request
   */
  private extractContextPatterns(request: AgentRequest): string[] {
    const patterns: string[] = [];

    if (request.context?.codeArea) {
      patterns.push(`area:${request.context.codeArea}`);
    }

    if (request.context?.file) {
      // Extract file extension
      const ext = request.context.file.split(".").pop();
      if (ext) {
        patterns.push(`ext:${ext}`);
      }
    }

    return patterns;
  }

  /**
   * Calculate similarity between request and pattern
   */
  private calculateRequestPatternSimilarity(
    request: AgentRequest,
    pattern: Pattern
  ): number {
    // Type match
    const typeMatch = request.type === pattern.requestType ? 0.3 : 0;

    // Keyword similarity (Jaccard)
    const k1 = new Set(request.keywords);
    const k2 = new Set(pattern.keywords);
    const intersection = new Set([...k1].filter((x) => k2.has(x)));
    const union = new Set([...k1, ...k2]);
    const keywordSim = union.size > 0 ? (intersection.size / union.size) * 0.5 : 0;

    // Context similarity
    const requestPatterns = this.extractContextPatterns(request);
    const contextMatch = pattern.contextPatterns.some((p) => requestPatterns.includes(p))
      ? 0.2
      : 0;

    return typeMatch + keywordSim + contextMatch;
  }

  /**
   * Convert database row to Pattern object
   */
  private rowToPattern(row: any): Pattern {
    return {
      id: row.id,
      signature: row.signature,
      requestType: row.request_type,
      keywords: JSON.parse(row.keywords || "[]"),
      contextPatterns: JSON.parse(row.context_patterns || "[]"),
      totalOccurrences: row.total_occurrences,
      confidenceScore: row.confidence_score,
      lastSeen: new Date(row.last_seen),
      suggestedResponse: row.suggested_response,
      autoResponseEnabled: row.auto_response_enabled === 1,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Convert database row to PatternResponse object
   */
  private rowToPatternResponse(row: any): PatternResponse {
    return {
      id: row.id,
      patternId: row.pattern_id,
      responseValue: row.response_value,
      timestamp: new Date(row.timestamp),
      userConfidence: row.user_confidence,
      wasOverridden: row.was_overridden === 1,
    };
  }
}
