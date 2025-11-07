/**
 * Auto Responder Service
 * Automatically responds to agent requests based on learned patterns
 */

import type { AgentRequest, UserResponse } from "./agent-router-types.js";
import { PatternMatcher, type Pattern } from "./pattern-matcher.js";
import { EventEmitter } from "events";

export interface AutoResponseConfig {
  enabled: boolean;
  minConfidence: number; // 0-100
  minOccurrences: number;
  notifyUser: boolean;
  respectRecentOverrides: boolean; // Don't auto-respond if recently overridden
  overrideWindowDays: number; // Days to look back for overrides
}

export const DEFAULT_AUTO_RESPONSE_CONFIG: AutoResponseConfig = {
  enabled: true,
  minConfidence: 90,
  minOccurrences: 5,
  notifyUser: true,
  respectRecentOverrides: true,
  overrideWindowDays: 7,
};

export interface AutoResponseDecision {
  shouldAutoRespond: boolean;
  pattern?: Pattern;
  response?: string;
  confidence?: number;
  reason?: string;
}

export class AutoResponder extends EventEmitter {
  private patternMatcher: PatternMatcher;
  private config: AutoResponseConfig;

  constructor(patternMatcher: PatternMatcher, config?: Partial<AutoResponseConfig>) {
    super();
    this.patternMatcher = patternMatcher;
    this.config = { ...DEFAULT_AUTO_RESPONSE_CONFIG, ...config };
  }

  /**
   * Try to auto-respond to a request
   * Returns UserResponse if auto-responded, null otherwise
   */
  async tryAutoRespond(request: AgentRequest): Promise<UserResponse | null> {
    const decision = await this.shouldAutoRespond(request);

    if (!decision.shouldAutoRespond || !decision.pattern || !decision.response) {
      return null;
    }

    // Create auto-response
    const autoResponse: UserResponse = {
      requestId: request.id,
      value: decision.response,
      timestamp: new Date(),
      auto: true,
      patternId: decision.pattern.id,
      confidence: decision.confidence,
    };

    // Emit event for logging/notification
    this.emit("auto_response", {
      request,
      response: autoResponse,
      pattern: decision.pattern,
    });

    return autoResponse;
  }

  /**
   * Determine if request should be auto-responded
   */
  async shouldAutoRespond(request: AgentRequest): Promise<AutoResponseDecision> {
    // Check if auto-response is enabled
    if (!this.config.enabled) {
      return {
        shouldAutoRespond: false,
        reason: "Auto-response is disabled",
      };
    }

    // Find matching pattern
    const pattern = await this.patternMatcher.findPattern(request);

    if (!pattern) {
      return {
        shouldAutoRespond: false,
        reason: "No matching pattern found",
      };
    }

    // Check if auto-response is enabled for this pattern
    if (!pattern.autoResponseEnabled) {
      return {
        shouldAutoRespond: false,
        pattern,
        reason: "Auto-response not enabled for this pattern",
      };
    }

    // Check confidence threshold
    if (pattern.confidenceScore < this.config.minConfidence) {
      return {
        shouldAutoRespond: false,
        pattern,
        reason: `Confidence too low: ${pattern.confidenceScore}% < ${this.config.minConfidence}%`,
      };
    }

    // Check occurrences threshold
    if (pattern.totalOccurrences < this.config.minOccurrences) {
      return {
        shouldAutoRespond: false,
        pattern,
        reason: `Not enough occurrences: ${pattern.totalOccurrences} < ${this.config.minOccurrences}`,
      };
    }

    // Check for recent overrides
    if (this.config.respectRecentOverrides) {
      const hasRecentOverride = await this.hasRecentOverride(pattern.id);
      if (hasRecentOverride) {
        return {
          shouldAutoRespond: false,
          pattern,
          reason: "Pattern was recently overridden",
        };
      }
    }

    // All checks passed
    return {
      shouldAutoRespond: true,
      pattern,
      response: pattern.suggestedResponse!,
      confidence: pattern.confidenceScore,
    };
  }

  /**
   * Check if pattern has been overridden recently
   */
  private async hasRecentOverride(patternId: string): Promise<boolean> {
    const responses = this.patternMatcher.getPatternResponses(patternId);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.overrideWindowDays);

    const recentOverrides = responses.filter(
      (r) => r.wasOverridden && r.timestamp >= cutoffDate
    );

    return recentOverrides.length > 0;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AutoResponseConfig>): void {
    this.config = { ...this.config, ...config };
    this.emit("config_updated", this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): AutoResponseConfig {
    return { ...this.config };
  }

  /**
   * Get auto-response statistics
   */
  async getStats(): Promise<{
    totalPatterns: number;
    autoResponseEnabled: number;
    averageConfidence: number;
    totalResponses: number;
  }> {
    const allPatterns = this.patternMatcher.getAllPatterns();
    const autoResponsePatterns = allPatterns.filter((p) => p.autoResponseEnabled);

    const totalResponses = autoResponsePatterns.reduce(
      (sum, p) => sum + p.totalOccurrences,
      0
    );

    const averageConfidence =
      autoResponsePatterns.length > 0
        ? autoResponsePatterns.reduce((sum, p) => sum + p.confidenceScore, 0) /
          autoResponsePatterns.length
        : 0;

    return {
      totalPatterns: allPatterns.length,
      autoResponseEnabled: autoResponsePatterns.length,
      averageConfidence: Math.round(averageConfidence * 10) / 10,
      totalResponses,
    };
  }
}
