/**
 * Tests for deployment error formatting
 */

import { describe, it, expect } from 'vitest';
import {
  AuthenticationError,
  GitContextError,
  ProviderError,
  NetworkError,
  ConfigurationError,
  DeploymentNotFoundError,
  PortConflictError,
  formatErrorMessage,
  isAuthenticationError,
  isGitContextError,
  isProviderError,
  isNetworkError,
  isConfigurationError,
  isDeploymentNotFoundError,
  isPortConflictError,
} from '../../../src/deploy/errors.js';

describe('Error Type Guards', () => {
  it('should identify AuthenticationError', () => {
    const error = new AuthenticationError('Test error', 'github');
    expect(isAuthenticationError(error)).toBe(true);
    expect(isGitContextError(error)).toBe(false);
  });

  it('should identify GitContextError', () => {
    const error = new GitContextError('Test error');
    expect(isGitContextError(error)).toBe(true);
    expect(isAuthenticationError(error)).toBe(false);
  });

  it('should identify ProviderError', () => {
    const error = new ProviderError('Test error', 'codespaces');
    expect(isProviderError(error)).toBe(true);
    expect(isAuthenticationError(error)).toBe(false);
  });

  it('should identify NetworkError', () => {
    const error = new NetworkError('Test error', 'deploy');
    expect(isNetworkError(error)).toBe(true);
    expect(isAuthenticationError(error)).toBe(false);
  });

  it('should identify ConfigurationError', () => {
    const error = new ConfigurationError('Test error', 'port');
    expect(isConfigurationError(error)).toBe(true);
    expect(isAuthenticationError(error)).toBe(false);
  });

  it('should identify DeploymentNotFoundError', () => {
    const error = new DeploymentNotFoundError('test-id');
    expect(isDeploymentNotFoundError(error)).toBe(true);
    expect(isAuthenticationError(error)).toBe(false);
  });

  it('should identify PortConflictError', () => {
    const error = new PortConflictError(3000);
    expect(isPortConflictError(error)).toBe(true);
    expect(isAuthenticationError(error)).toBe(false);
  });
});

describe('Error Message Formatting', () => {
  describe('AuthenticationError', () => {
    it('should format GitHub authentication error', () => {
      const error = new AuthenticationError('Not authenticated', 'github');
      const message = formatErrorMessage(error);
      
      expect(message).toContain('✗ GitHub CLI is not authenticated');
      expect(message).toContain('Sudocode needs GitHub CLI to deploy to Codespaces');
      expect(message).toContain('To authenticate:');
      expect(message).toContain('gh auth login');
    });

    it('should format Claude authentication error', () => {
      const error = new AuthenticationError('Not authenticated', 'claude');
      const message = formatErrorMessage(error);
      
      expect(message).toContain('✗ Claude CLI is not authenticated');
      expect(message).toContain('Sudocode needs Claude authentication to deploy to Codespaces');
      expect(message).toContain('To authenticate with Claude:');
      expect(message).toContain('sudocode auth claude');
    });

    it('should use custom hint if provided', () => {
      const error = new AuthenticationError('Not authenticated', 'github', 'Custom hint: try this');
      const message = formatErrorMessage(error);
      
      expect(message).toContain('Custom hint: try this');
    });
  });

  describe('GitContextError', () => {
    it('should format git repository not found error', () => {
      const error = new GitContextError('Not in a git repository');
      const message = formatErrorMessage(error);
      
      expect(message).toContain('✗ Git repository not found');
      expect(message).toContain('This command must be run from within a git repository');
      expect(message).toContain('To initialize a repository:');
      expect(message).toContain('git init');
    });

    it('should format no remote error', () => {
      const error = new GitContextError('No remote configured');
      const message = formatErrorMessage(error);
      
      expect(message).toContain('✗ GitHub remote not configured');
      expect(message).toContain('Your git repository needs a GitHub remote to deploy');
      expect(message).toContain('To add a remote:');
      expect(message).toContain('git remote add origin <github-url>');
    });

    it('should format branch error', () => {
      const error = new GitContextError('Branch not found: feature/test');
      const message = formatErrorMessage(error);
      
      expect(message).toContain('✗ Git branch not found');
      expect(message).toContain('Branch not found: feature/test');
      expect(message).toContain('To see available branches:');
      expect(message).toContain('git branch -a');
    });

    it('should use custom hint if provided', () => {
      const error = new GitContextError('Git error', 'Run git status');
      const message = formatErrorMessage(error);
      
      expect(message).toContain('Run git status');
    });
  });

  describe('ProviderError', () => {
    it('should format provider error', () => {
      const error = new ProviderError('API request failed', 'codespaces');
      const message = formatErrorMessage(error);
      
      expect(message).toContain('✗ Deployment to codespaces failed');
      expect(message).toContain('API request failed');
      expect(message).toContain('Check your network connection and try again, or visit:');
      expect(message).toContain('https://github.com/codespaces for service status');
    });

    it('should include original error context', () => {
      const originalError = new Error('Connection timeout');
      const error = new ProviderError('API request failed', 'codespaces', originalError);
      const message = formatErrorMessage(error);
      
      expect(message).toContain('Context: Connection timeout');
    });
  });

  describe('NetworkError', () => {
    it('should format network error', () => {
      const error = new NetworkError('Connection failed', 'list deployments');
      const message = formatErrorMessage(error);
      
      expect(message).toContain('✗ Network connection failed');
      expect(message).toContain('Unable to list deployments due to network issues');
      expect(message).toContain('Suggested actions:');
      expect(message).toContain('• Check your internet connection');
      expect(message).toContain('• Verify VPN or proxy settings');
      expect(message).toContain('• Try again in a few moments');
    });
  });

  describe('ConfigurationError', () => {
    it('should format configuration error with field', () => {
      const error = new ConfigurationError('Port must be between 1024 and 65535', 'port');
      const message = formatErrorMessage(error);
      
      expect(message).toContain('✗ Invalid configuration: port');
      expect(message).toContain('Port must be between 1024 and 65535');
      expect(message).toContain('To view current configuration:');
      expect(message).toContain('sudocode deploy config');
    });

    it('should format configuration error without field', () => {
      const error = new ConfigurationError('Invalid configuration');
      const message = formatErrorMessage(error);
      
      expect(message).toContain('✗ Invalid configuration');
      expect(message).toContain('Invalid configuration');
      expect(message).toContain('To view current configuration:');
      expect(message).toContain('sudocode deploy config');
    });
  });

  describe('DeploymentNotFoundError', () => {
    it('should format deployment not found error', () => {
      const error = new DeploymentNotFoundError('sudocode-test-123');
      const message = formatErrorMessage(error);
      
      expect(message).toContain("✗ Deployment 'sudocode-test-123' not found");
      expect(message).toContain('The specified deployment does not exist or has been deleted');
      expect(message).toContain('To list all deployments:');
      expect(message).toContain('sudocode deploy list');
    });
  });

  describe('PortConflictError', () => {
    it('should format port conflict error', () => {
      const error = new PortConflictError(3000);
      const message = formatErrorMessage(error);
      
      expect(message).toContain('✗ Port 3000 is already in use');
      expect(message).toContain('The requested port is not available on your system');
      expect(message).toContain('To use a different port:');
      expect(message).toContain('sudocode deploy --port 3001');
    });

    it('should suggest next port number', () => {
      const error = new PortConflictError(8080);
      const message = formatErrorMessage(error);
      
      expect(message).toContain('sudocode deploy --port 8081');
    });
  });

  describe('Generic Errors', () => {
    it('should format generic Error', () => {
      const error = new Error('Something went wrong');
      const message = formatErrorMessage(error);
      
      expect(message).toContain('✗ An error occurred');
      expect(message).toContain('Something went wrong');
    });

    it('should format unknown error', () => {
      const error = 'String error';
      const message = formatErrorMessage(error);
      
      expect(message).toContain('✗ An unexpected error occurred');
      expect(message).toContain('String error');
    });
  });
});

describe('Error Message Structure', () => {
  it('should have consistent structure with title, explanation, and action', () => {
    const error = new AuthenticationError('Test', 'github');
    const message = formatErrorMessage(error);
    
    // Should start with ✗ symbol
    expect(message).toMatch(/^✗/);
    
    // Should have multiple lines with proper spacing
    const lines = message.split('\n');
    expect(lines.length).toBeGreaterThan(3);
    
    // Should have indented explanation
    expect(message).toMatch(/\n  [A-Z]/); // Indented explanation
    
    // Should have action section
    expect(message).toMatch(/To authenticate:/);
  });

  it('should properly indent multi-line suggestions', () => {
    const error = new NetworkError('Test', 'operation');
    const message = formatErrorMessage(error);
    
    // Should have bullet points with proper indentation
    expect(message).toContain('    • Check your internet connection');
    expect(message).toContain('    • Verify VPN or proxy settings');
    expect(message).toContain('    • Try again in a few moments');
  });
});

describe('Error Codes', () => {
  it('should set correct error codes', () => {
    expect(new AuthenticationError('Test', 'github').code).toBe('AUTH_ERROR');
    expect(new GitContextError('Test').code).toBe('GIT_CONTEXT_ERROR');
    expect(new ProviderError('Test', 'codespaces').code).toBe('PROVIDER_ERROR');
    expect(new NetworkError('Test', 'operation').code).toBe('NETWORK_ERROR');
    expect(new ConfigurationError('Test').code).toBe('CONFIG_ERROR');
    expect(new DeploymentNotFoundError('test').code).toBe('NOT_FOUND');
    expect(new PortConflictError(3000).code).toBe('PORT_CONFLICT');
  });
});

describe('Error Properties', () => {
  it('should preserve AuthenticationError properties', () => {
    const error = new AuthenticationError('Test', 'github', 'hint');
    expect(error.service).toBe('github');
    expect(error.hint).toBe('hint');
  });

  it('should preserve GitContextError properties', () => {
    const error = new GitContextError('Test', 'hint');
    expect(error.hint).toBe('hint');
  });

  it('should preserve ProviderError properties', () => {
    const originalError = new Error('Original');
    const error = new ProviderError('Test', 'codespaces', originalError);
    expect(error.provider).toBe('codespaces');
    expect(error.originalError).toBe(originalError);
  });

  it('should preserve NetworkError properties', () => {
    const originalError = new Error('Original');
    const error = new NetworkError('Test', 'operation', originalError);
    expect(error.operation).toBe('operation');
    expect(error.originalError).toBe(originalError);
  });

  it('should preserve ConfigurationError properties', () => {
    const error = new ConfigurationError('Test', 'port');
    expect(error.field).toBe('port');
  });

  it('should preserve DeploymentNotFoundError properties', () => {
    const error = new DeploymentNotFoundError('test-123');
    expect(error.deploymentId).toBe('test-123');
  });

  it('should preserve PortConflictError properties', () => {
    const error = new PortConflictError(3000);
    expect(error.port).toBe(3000);
  });
});
