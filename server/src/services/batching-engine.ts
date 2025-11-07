/**
 * Batching Engine for Agent Router
 * Groups similar agent requests together to reduce context switching
 */

import type { AgentRequest } from "./agent-router-types.js";

export interface RequestBatch {
  id: string;
  requests: AgentRequest[];
  batchingKey?: string;
  similarityScore: number;
  createdAt: Date;
}

export class BatchingEngine {
  private similarityThreshold: number;
  private minBatchSize: number;
  private batchTimeWindowMs: number;

  constructor(config?: {
    similarityThreshold?: number;
    minBatchSize?: number;
    batchTimeWindowMs?: number;
  }) {
    this.similarityThreshold = config?.similarityThreshold || 0.7;
    this.minBatchSize = config?.minBatchSize || 2;
    this.batchTimeWindowMs = config?.batchTimeWindowMs || 30000; // 30 seconds
  }

  /**
   * Find requests that can be batched together
   */
  findBatchable(requests: AgentRequest[]): RequestBatch[] {
    if (requests.length < this.minBatchSize) {
      return [];
    }

    // Filter requests within time window
    const now = Date.now();
    const recentRequests = requests.filter((r) => {
      const age = now - r.createdAt.getTime();
      return age <= this.batchTimeWindowMs;
    });

    if (recentRequests.length < this.minBatchSize) {
      return [];
    }

    const batches = new Map<string, AgentRequest[]>();

    // Strategy 1: Explicit batching key
    for (const request of recentRequests) {
      if (request.batchingKey) {
        const existing = batches.get(request.batchingKey) || [];
        existing.push(request);
        batches.set(request.batchingKey, existing);
      }
    }

    // Strategy 2: Keyword similarity matching
    const unbatchedRequests = recentRequests.filter((r) => !r.batchingKey);

    for (const request of unbatchedRequests) {
      let foundBatch = false;

      // Try to find an existing batch this request can join
      for (const [key, batch] of batches.entries()) {
        if (batch.length === 0) continue;

        const similarity = this.calculateSimilarity(request, batch[0]);
        if (similarity >= this.similarityThreshold) {
          batch.push(request);
          foundBatch = true;
          break;
        }
      }

      if (!foundBatch) {
        // Create a new batch with this request
        const newKey = `similarity:${request.patternSignature || request.id}`;
        batches.set(newKey, [request]);
      }
    }

    // Strategy 3: Context proximity (same file/code area)
    for (const request of unbatchedRequests) {
      if (!request.context?.codeArea) continue;

      const contextKey = `context:${request.context.codeArea}`;
      const existing = batches.get(contextKey) || [];

      // Only batch if not already in another batch
      const alreadyBatched = Array.from(batches.values()).some((batch) =>
        batch.some((r) => r.id === request.id)
      );

      if (!alreadyBatched) {
        existing.push(request);
        batches.set(contextKey, existing);
      }
    }

    // Convert to RequestBatch objects, filtering out single-item batches
    const result: RequestBatch[] = [];

    for (const [key, requests] of batches.entries()) {
      if (requests.length >= this.minBatchSize) {
        // Calculate average similarity score for the batch
        let totalSimilarity = 0;
        let comparisons = 0;

        for (let i = 0; i < requests.length - 1; i++) {
          for (let j = i + 1; j < requests.length; j++) {
            totalSimilarity += this.calculateSimilarity(requests[i], requests[j]);
            comparisons++;
          }
        }

        const avgSimilarity = comparisons > 0 ? totalSimilarity / comparisons : 1.0;

        result.push({
          id: `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          requests,
          batchingKey: key.startsWith("context:") || key.startsWith("similarity:") ? undefined : key,
          similarityScore: avgSimilarity,
          createdAt: new Date(Math.min(...requests.map((r) => r.createdAt.getTime()))),
        });
      }
    }

    // Sort batches by oldest request time
    result.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    return result;
  }

  /**
   * Calculate similarity between two requests (0-1)
   */
  private calculateSimilarity(r1: AgentRequest, r2: AgentRequest): number {
    // Same request type increases similarity
    const typeSimilarity = r1.type === r2.type ? 0.3 : 0;

    // Keyword overlap (Jaccard similarity)
    const k1 = new Set(r1.keywords);
    const k2 = new Set(r2.keywords);
    const intersection = new Set([...k1].filter((x) => k2.has(x)));
    const union = new Set([...k1, ...k2]);
    const keywordSimilarity = union.size > 0 ? (intersection.size / union.size) * 0.4 : 0;

    // Same issue increases similarity
    const issueSimilarity = r1.issueId === r2.issueId ? 0.2 : 0;

    // Context similarity (same code area)
    let contextSimilarity = 0;
    if (r1.context?.codeArea && r2.context?.codeArea) {
      contextSimilarity = r1.context.codeArea === r2.context.codeArea ? 0.1 : 0;
    }

    return typeSimilarity + keywordSimilarity + issueSimilarity + contextSimilarity;
  }

  /**
   * Extract common patterns from a batch
   */
  extractCommonPatterns(batch: RequestBatch): {
    commonKeywords: string[];
    commonType?: string;
    commonContext?: string;
    summary: string;
  } {
    const { requests } = batch;

    // Find common keywords
    const keywordCounts = new Map<string, number>();
    for (const request of requests) {
      for (const keyword of request.keywords) {
        keywordCounts.set(keyword, (keywordCounts.get(keyword) || 0) + 1);
      }
    }

    const commonKeywords = Array.from(keywordCounts.entries())
      .filter(([_, count]) => count >= requests.length / 2) // Present in at least half
      .map(([keyword]) => keyword)
      .slice(0, 5); // Top 5

    // Check if all same type
    const types = new Set(requests.map((r) => r.type));
    const commonType = types.size === 1 ? requests[0].type : undefined;

    // Check for common context
    const contexts = requests
      .map((r) => r.context?.codeArea)
      .filter((c): c is string => !!c);
    const contextCounts = new Map<string, number>();
    for (const context of contexts) {
      contextCounts.set(context, (contextCounts.get(context) || 0) + 1);
    }
    const mostCommonContext = Array.from(contextCounts.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0];

    // Generate summary
    let summary = `${requests.length} agents asking`;
    if (commonType) {
      summary += ` for ${commonType}`;
    }
    if (commonKeywords.length > 0) {
      summary += ` about: ${commonKeywords.join(", ")}`;
    }
    if (mostCommonContext) {
      summary += ` in ${mostCommonContext}`;
    }

    return {
      commonKeywords,
      commonType,
      commonContext: mostCommonContext,
      summary,
    };
  }

  /**
   * Check if a new request should be added to an existing batch
   */
  shouldAddToBatch(request: AgentRequest, batch: RequestBatch): boolean {
    if (batch.requests.length === 0) return false;

    // Check time window
    const now = Date.now();
    const batchAge = now - batch.createdAt.getTime();
    if (batchAge > this.batchTimeWindowMs) return false;

    // Check similarity with batch requests
    const avgSimilarity = batch.requests.reduce(
      (sum, r) => sum + this.calculateSimilarity(request, r),
      0
    ) / batch.requests.length;

    return avgSimilarity >= this.similarityThreshold;
  }
}
