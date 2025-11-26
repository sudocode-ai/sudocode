/**
 * Custom error classes for agent-specific errors
 *
 * These errors provide structured error information for multi-agent execution scenarios,
 * including error codes and details for frontend consumption.
 */

/**
 * Base class for agent-related errors
 */
export class AgentError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown>;

  constructor(message: string, code: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error thrown when an agent is not found in the registry
 * HTTP Status: 400 Bad Request
 */
export class AgentNotFoundError extends AgentError {
  constructor(agentType: string, availableAgents: string[]) {
    super(
      `Agent '${agentType}' not found in registry`,
      'AGENT_NOT_FOUND',
      {
        agentType,
        availableAgents,
      }
    );
  }
}

/**
 * Error thrown when an agent is registered but not yet implemented (stub)
 * HTTP Status: 501 Not Implemented
 */
export class AgentNotImplementedError extends AgentError {
  constructor(agentType: string) {
    super(
      `Agent '${agentType}' is not yet implemented`,
      'AGENT_NOT_IMPLEMENTED',
      {
        agentType,
        message: 'This agent is registered but not yet fully implemented. Check back in a future release.',
      }
    );
  }
}

/**
 * Error thrown when agent configuration fails validation
 * HTTP Status: 400 Bad Request
 */
export class AgentConfigValidationError extends AgentError {
  constructor(agentType: string, validationErrors: string[]) {
    super(
      'Agent configuration validation failed',
      'AGENT_CONFIG_VALIDATION_ERROR',
      {
        agentType,
        errors: validationErrors,
      }
    );
  }
}

/**
 * Error thrown when agent execution fails
 * HTTP Status: 500 Internal Server Error
 */
export class AgentExecutionError extends AgentError {
  constructor(agentType: string, message: string, details: Record<string, unknown> = {}) {
    super(
      message,
      'AGENT_EXECUTION_ERROR',
      {
        agentType,
        ...details,
      }
    );
  }
}
