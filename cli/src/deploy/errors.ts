/**
 * Custom error types for deployment operations
 * 
 * Provides structured error handling with specific error types
 * for different failure scenarios in deployment workflows.
 */

/**
 * Base class for all deployment-related errors
 */
export class DeploymentError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'DeploymentError';
    Object.setPrototypeOf(this, DeploymentError.prototype);
  }
}

/**
 * Authentication-related errors
 */
export class AuthenticationError extends DeploymentError {
  constructor(
    message: string,
    public readonly service: 'github' | 'claude',
    public readonly hint?: string
  ) {
    super(message, 'AUTH_ERROR');
    this.name = 'AuthenticationError';
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

/**
 * Git context detection errors
 */
export class GitContextError extends DeploymentError {
  constructor(
    message: string,
    public readonly hint?: string
  ) {
    super(message, 'GIT_CONTEXT_ERROR');
    this.name = 'GitContextError';
    Object.setPrototypeOf(this, GitContextError.prototype);
  }
}

/**
 * Provider-specific deployment errors
 */
export class ProviderError extends DeploymentError {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly originalError?: Error
  ) {
    super(message, 'PROVIDER_ERROR');
    this.name = 'ProviderError';
    Object.setPrototypeOf(this, ProviderError.prototype);
  }
}

/**
 * Network-related errors
 */
export class NetworkError extends DeploymentError {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: Error
  ) {
    super(message, 'NETWORK_ERROR');
    this.name = 'NetworkError';
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

/**
 * Configuration errors
 */
export class ConfigurationError extends DeploymentError {
  constructor(
    message: string,
    public readonly field?: string
  ) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigurationError';
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}

/**
 * Deployment not found errors
 */
export class DeploymentNotFoundError extends DeploymentError {
  constructor(
    public readonly deploymentId: string
  ) {
    super(`Deployment '${deploymentId}' not found`, 'NOT_FOUND');
    this.name = 'DeploymentNotFoundError';
    Object.setPrototypeOf(this, DeploymentNotFoundError.prototype);
  }
}

/**
 * Port conflict errors
 */
export class PortConflictError extends DeploymentError {
  constructor(
    public readonly port: number,
    message?: string
  ) {
    super(message || `Port ${port} is already in use`, 'PORT_CONFLICT');
    this.name = 'PortConflictError';
    Object.setPrototypeOf(this, PortConflictError.prototype);
  }
}

/**
 * Type guard to check if an error is a deployment error
 */
export function isDeploymentError(error: unknown): error is DeploymentError {
  return error instanceof DeploymentError;
}

/**
 * Type guard to check if an error is an authentication error
 */
export function isAuthenticationError(error: unknown): error is AuthenticationError {
  return error instanceof AuthenticationError;
}

/**
 * Type guard to check if an error is a git context error
 */
export function isGitContextError(error: unknown): error is GitContextError {
  return error instanceof GitContextError;
}

/**
 * Type guard to check if an error is a provider error
 */
export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}

/**
 * Type guard to check if an error is a network error
 */
export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}

/**
 * Type guard to check if an error is a configuration error
 */
export function isConfigurationError(error: unknown): error is ConfigurationError {
  return error instanceof ConfigurationError;
}

/**
 * Type guard to check if an error is a deployment not found error
 */
export function isDeploymentNotFoundError(error: unknown): error is DeploymentNotFoundError {
  return error instanceof DeploymentNotFoundError;
}

/**
 * Type guard to check if an error is a port conflict error
 */
export function isPortConflictError(error: unknown): error is PortConflictError {
  return error instanceof PortConflictError;
}

/**
 * Format error message with consistent styling
 * 
 * Format:
 * ✗ Error Title
 * 
 *   Detailed explanation of what went wrong
 *   
 *   Suggested action:
 *     command to run or steps to take
 */
export interface FormattedError {
  title: string;
  explanation: string;
  action?: string;
  command?: string;
  context?: string;
}

/**
 * Helper to format error messages for CLI output with consistent styling
 */
export function formatErrorMessage(error: unknown): string {
  if (isAuthenticationError(error)) {
    return formatErrorOutput({
      title: `${error.service === 'github' ? 'GitHub' : 'Claude'} CLI is not authenticated`,
      explanation: `Sudocode needs ${error.service === 'github' ? 'GitHub CLI' : 'Claude authentication'} to deploy to Codespaces.`,
      action: error.service === 'github' ? 'To authenticate' : 'To authenticate with Claude',
      command: error.hint || (error.service === 'github' ? 'gh auth login' : 'sudocode auth claude')
    });
  }
  
  if (isGitContextError(error)) {
    let title = 'Git repository not found';
    let explanation = 'This command must be run from within a git repository.';
    let action = 'To initialize a repository';
    let command = 'git init';
    
    if (error.message.toLowerCase().includes('branch')) {
      title = 'Git branch not found';
      explanation = error.message;
      action = 'To see available branches';
      command = 'git branch -a';
    } else if (error.message.includes('No remote') || error.message.includes('remote')) {
      title = 'GitHub remote not configured';
      explanation = 'Your git repository needs a GitHub remote to deploy.';
      action = 'To add a remote';
      command = 'git remote add origin <github-url>';
    }
    
    return formatErrorOutput({
      title,
      explanation,
      action: error.hint || action,
      command: !error.hint ? command : undefined
    });
  }
  
  if (isProviderError(error)) {
    return formatErrorOutput({
      title: `Deployment to ${error.provider} failed`,
      explanation: error.message,
      context: error.originalError?.message,
      action: 'Check your network connection and try again, or visit',
      command: 'https://github.com/codespaces for service status'
    });
  }
  
  if (isNetworkError(error)) {
    return formatErrorOutput({
      title: 'Network connection failed',
      explanation: `Unable to ${error.operation} due to network issues.`,
      action: 'Suggested actions',
      command: [
        '• Check your internet connection',
        '• Verify VPN or proxy settings',
        '• Try again in a few moments'
      ].join('\n    ')
    });
  }
  
  if (isConfigurationError(error)) {
    return formatErrorOutput({
      title: `Invalid configuration${error.field ? `: ${error.field}` : ''}`,
      explanation: error.message,
      action: 'To view current configuration',
      command: 'sudocode deploy config'
    });
  }
  
  if (isDeploymentNotFoundError(error)) {
    return formatErrorOutput({
      title: `Deployment '${error.deploymentId}' not found`,
      explanation: 'The specified deployment does not exist or has been deleted.',
      action: 'To list all deployments',
      command: 'sudocode deploy list'
    });
  }
  
  if (isPortConflictError(error)) {
    return formatErrorOutput({
      title: `Port ${error.port} is already in use`,
      explanation: 'The requested port is not available on your system.',
      action: 'To use a different port',
      command: `sudocode deploy --port ${error.port + 1}`
    });
  }
  
  if (isDeploymentError(error)) {
    return formatErrorOutput({
      title: 'Deployment failed',
      explanation: error.message
    });
  }
  
  if (error instanceof Error) {
    return formatErrorOutput({
      title: 'An error occurred',
      explanation: error.message
    });
  }
  
  return formatErrorOutput({
    title: 'An unexpected error occurred',
    explanation: String(error)
  });
}

/**
 * Format error output with consistent structure
 */
function formatErrorOutput(error: FormattedError): string {
  const lines: string[] = [];
  
  // Title with ✗ symbol
  lines.push(`✗ ${error.title}`);
  lines.push('');
  
  // Explanation (indented)
  if (error.explanation) {
    lines.push(`  ${error.explanation}`);
    lines.push('');
  }
  
  // Context if provided (indented, gray)
  if (error.context) {
    lines.push(`  Context: ${error.context}`);
    lines.push('');
  }
  
  // Action and command (indented)
  if (error.action) {
    lines.push(`  ${error.action}:`);
    if (error.command) {
      // If command contains newlines, it's already formatted
      if (error.command.includes('\n')) {
        lines.push(`    ${error.command}`);
      } else {
        lines.push(`    ${error.command}`);
      }
    }
  }
  
  return lines.join('\n');
}

/**
 * Helper to get actionable hints for common errors
 * @deprecated Use formatErrorMessage instead for consistent formatting
 */
export function getErrorHint(error: unknown): string | null {
  if (isAuthenticationError(error)) {
    if (error.hint) return error.hint;
    if (error.service === 'github') {
      return 'Run: gh auth login';
    }
    if (error.service === 'claude') {
      return 'Run: sudocode auth claude';
    }
  }
  
  if (isGitContextError(error)) {
    if (error.hint) return error.hint;
    if (error.message.includes('Not in a git repository')) {
      return 'Navigate to a git repository or initialize one with: git init';
    }
    if (error.message.includes('No remote')) {
      return 'Add a GitHub remote with: git remote add origin <url>';
    }
  }
  
  if (isDeploymentNotFoundError(error)) {
    return 'List deployments with: sudocode deploy list';
  }
  
  if (isPortConflictError(error)) {
    return `Use a different port with: --port <number>`;
  }
  
  return null;
}
