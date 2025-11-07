/**
 * Type definitions for Agent Router system
 */

export type RequestType = 'confirmation' | 'guidance' | 'choice' | 'input';
export type RequestStatus = 'queued' | 'presented' | 'responded' | 'expired' | 'cancelled';
export type IssuePriority = 'critical' | 'high' | 'medium' | 'low';
export type Urgency = 'blocking' | 'non-blocking';

export interface ResponseOption {
  value: string;
  label: string;
  description?: string;
}

export interface RequestContext {
  file?: string;
  function?: string;
  codeArea?: string;
  relatedRequests?: string[];
}

export interface AgentRequest {
  id: string;
  executionId: string;
  issueId: string;
  issuePriority: IssuePriority;

  // Request details
  type: RequestType;
  message: string;
  context?: RequestContext;

  // Timing
  createdAt: Date;
  expiresAt?: Date;

  // Batching hints
  batchingKey?: string;
  keywords: string[];

  // Priority calculation
  urgency: Urgency;
  estimatedImpact: number; // 0-100

  // Response options
  options?: ResponseOption[];
  defaultResponse?: string;

  // Pattern matching
  patternSignature?: string;

  // Status
  status: RequestStatus;
  presentedAt?: Date;
  respondedAt?: Date;

  // Response
  responseValue?: string;
  responseAuto?: boolean;
  responsePatternId?: string;
}

export interface UserResponse {
  requestId: string;
  value: string;
  timestamp: Date;
  auto?: boolean;
  patternId?: string;
  confidence?: number;
}

export interface QueueStats {
  total: number;
  queued: number;
  presented: number;
  responded: number;
  byPriority: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  averageWaitTime: number; // milliseconds
  oldestRequest?: AgentRequest;
}

export interface AgentRouterConfig {
  // Queue settings
  maxQueueSize: number;
  requestTimeout: number; // seconds

  // Priority
  defaultPriority: IssuePriority;
  priorityWeights: {
    issuePriority: number;
    urgency: number;
    waitTime: number;
    impact: number;
  };

  // Notifications
  notifyOnRequest: boolean;
}

export const DEFAULT_ROUTER_CONFIG: AgentRouterConfig = {
  maxQueueSize: 100,
  requestTimeout: 3600, // 1 hour
  defaultPriority: 'medium',
  priorityWeights: {
    issuePriority: 0.4,
    urgency: 0.3,
    waitTime: 0.15,
    impact: 0.15,
  },
  notifyOnRequest: true,
};
