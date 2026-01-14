/**
 * Tests for auth status command
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { showAuthStatus } from '../../../src/auth/status.js';
import * as credentialsModule from '../../../src/auth/credentials.js';

describe('showAuthStatus', () => {
  let tempDir: string;
  let originalEnv: string | undefined;
  let consoleLogSpy: any;
  
  beforeEach(async () => {
    // Create temp directory for test isolation
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sudocode-auth-status-test-'));
    
    // Set XDG_CONFIG_HOME to temp directory
    originalEnv = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = tempDir;
    
    // Spy on console.log
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  
  afterEach(async () => {
    // Restore environment
    if (originalEnv !== undefined) {
      process.env.XDG_CONFIG_HOME = originalEnv;
    } else {
      delete process.env.XDG_CONFIG_HOME;
    }
    
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
    
    // Restore console.log
    consoleLogSpy.mockRestore();
  });
  
  describe('Human-readable output', () => {
    it('should display all credentials configured', async () => {
      // Setup: Create credentials file with all types
      const sudocodeDir = path.join(tempDir, 'sudocode');
      await fs.mkdir(sudocodeDir, { recursive: true });
      const credentialsFile = path.join(sudocodeDir, 'user_credentials.json');
      
      await fs.writeFile(credentialsFile, JSON.stringify({
        claudeCodeOAuthToken: 'sk-ant-api03-1234567890abcdefghijklmnopqrstuvwxyz',
        llmKey: 'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890',
        litellmCredentials: {
          api_base: 'https://api.openai.com/v1',
          api_key: 'sk-litellm-1234567890abcdefghijklmnopqrstuvwxyz'
        }
      }, null, 2));
      
      await fs.chmod(credentialsFile, 0o600);
      
      // Execute
      await showAuthStatus({});
      
      // Verify output
      const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      
      expect(output).toContain('Authentication Status:');
      expect(output).toContain('Claude Code: ✓ Configured');
      expect(output).toMatch(/Token: sk-ant-api03-12\*+xyz/);
      expect(output).toContain('LLM Key: ✓ Configured');
      expect(output).toMatch(/Key: sk-proj-abcdefg\*+890/);
      expect(output).toContain('LiteLLM: ✓ Configured');
      expect(output).toContain('API Base: https://api.openai.com/v1');
      expect(output).toMatch(/API Key: sk-litellm-1234\*+xyz/);
      expect(output).toContain('Configured: 3/3 services');
      expect(output).toContain('✓ Ready for remote deployment');
    });
    
    it('should display no credentials configured', async () => {
      // No credentials file exists
      
      // Execute
      await showAuthStatus({});
      
      // Verify output
      const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      
      expect(output).toContain('Authentication Status:');
      expect(output).toContain('Claude Code: ✗ Not configured');
      expect(output).toContain('Run: sudocode auth claude');
      expect(output).toContain('LLM Key: ✗ Not configured');
      expect(output).toContain('Run: sudocode auth llm --key <key> (coming soon)');
      expect(output).toContain('LiteLLM: ✗ Not configured');
      expect(output).toContain('Run: sudocode auth litellm (coming soon)');
      expect(output).toContain('Configured: 0/3 services');
      expect(output).toContain('⚠ No credentials configured. Remote deployment unavailable.');
    });
    
    it('should display partial credentials (Claude only)', async () => {
      // Setup: Create credentials file with only Claude token
      const sudocodeDir = path.join(tempDir, 'sudocode');
      await fs.mkdir(sudocodeDir, { recursive: true });
      const credentialsFile = path.join(sudocodeDir, 'user_credentials.json');
      
      await fs.writeFile(credentialsFile, JSON.stringify({
        claudeCodeOAuthToken: 'sk-ant-api03-1234567890abcdefghijklmnopqrstuvwxyz'
      }, null, 2));
      
      await fs.chmod(credentialsFile, 0o600);
      
      // Execute
      await showAuthStatus({});
      
      // Verify output
      const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      
      expect(output).toContain('Claude Code: ✓ Configured');
      expect(output).toContain('LLM Key: ✗ Not configured');
      expect(output).toContain('LiteLLM: ✗ Not configured');
      expect(output).toContain('Configured: 1/3 services');
      expect(output).toContain('✓ Ready for remote deployment');
    });
    
    it('should mask tokens correctly', async () => {
      // Setup: Create credentials file
      const sudocodeDir = path.join(tempDir, 'sudocode');
      await fs.mkdir(sudocodeDir, { recursive: true });
      const credentialsFile = path.join(sudocodeDir, 'user_credentials.json');
      
      await fs.writeFile(credentialsFile, JSON.stringify({
        claudeCodeOAuthToken: 'sk-ant-api03-1234567890abcdefghijklmnopqrstuvwxyz'
      }, null, 2));
      
      await fs.chmod(credentialsFile, 0o600);
      
      // Execute
      await showAuthStatus({});
      
      // Verify token is masked
      const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      
      // Should show first 15 chars and last 3 chars with asterisks in between
      expect(output).toMatch(/sk-ant-api03-12\*+xyz/);
      // Should NOT show full token
      expect(output).not.toContain('sk-ant-api03-1234567890abcdefghijklmnopqrstuvwxyz');
    });
  });
  
  describe('JSON output', () => {
    it('should output JSON format when json option is true', async () => {
      // Setup: Create credentials file with Claude token
      const sudocodeDir = path.join(tempDir, 'sudocode');
      await fs.mkdir(sudocodeDir, { recursive: true });
      const credentialsFile = path.join(sudocodeDir, 'user_credentials.json');
      
      await fs.writeFile(credentialsFile, JSON.stringify({
        claudeCodeOAuthToken: 'sk-ant-api03-1234567890abcdefghijklmnopqrstuvwxyz'
      }, null, 2));
      
      await fs.chmod(credentialsFile, 0o600);
      
      // Execute
      await showAuthStatus({ json: true });
      
      // Verify JSON output
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      
      expect(parsed).toMatchObject({
        configured: ['claude'],
        available: ['claude', 'llm', 'litellm'],
        ready: true,
        storage: '~/.config/sudocode/user_credentials.json',
        credentials: {
          claude: {
            configured: true,
            masked: expect.stringContaining('sk-ant-api03-12')
          },
          llm: {
            configured: false
          },
          litellm: {
            configured: false
          }
        }
      });
    });
    
    it('should output JSON with all credentials', async () => {
      // Setup: Create credentials file with all types
      const sudocodeDir = path.join(tempDir, 'sudocode');
      await fs.mkdir(sudocodeDir, { recursive: true });
      const credentialsFile = path.join(sudocodeDir, 'user_credentials.json');
      
      await fs.writeFile(credentialsFile, JSON.stringify({
        claudeCodeOAuthToken: 'sk-ant-api03-1234567890abcdefghijklmnopqrstuvwxyz',
        llmKey: 'sk-proj-abcdefghijklmnopqrstuvwxyz1234567890',
        litellmCredentials: {
          api_base: 'https://api.openai.com/v1',
          api_key: 'sk-litellm-1234567890abcdefghijklmnopqrstuvwxyz'
        }
      }, null, 2));
      
      await fs.chmod(credentialsFile, 0o600);
      
      // Execute
      await showAuthStatus({ json: true });
      
      // Verify JSON output
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      
      expect(parsed.configured).toEqual(['claude', 'llm', 'litellm']);
      expect(parsed.ready).toBe(true);
      expect(parsed.credentials.claude.configured).toBe(true);
      expect(parsed.credentials.llm.configured).toBe(true);
      expect(parsed.credentials.litellm.configured).toBe(true);
    });
    
    it('should output JSON with no credentials', async () => {
      // No credentials file exists
      
      // Execute
      await showAuthStatus({ json: true });
      
      // Verify JSON output
      const output = consoleLogSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      
      expect(parsed).toMatchObject({
        configured: [],
        available: ['claude', 'llm', 'litellm'],
        ready: false,
        credentials: {
          claude: { configured: false },
          llm: { configured: false },
          litellm: { configured: false }
        }
      });
    });
  });
  
  describe('Token masking edge cases', () => {
    it('should handle short tokens', async () => {
      // Setup: Create credentials file with short token
      const sudocodeDir = path.join(tempDir, 'sudocode');
      await fs.mkdir(sudocodeDir, { recursive: true });
      const credentialsFile = path.join(sudocodeDir, 'user_credentials.json');
      
      await fs.writeFile(credentialsFile, JSON.stringify({
        claudeCodeOAuthToken: 'short'
      }, null, 2));
      
      await fs.chmod(credentialsFile, 0o600);
      
      // Execute
      await showAuthStatus({});
      
      // Verify short token is masked safely
      const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('short***');
      expect(output).not.toContain('short\n'); // Ensure it's actually masked
    });
    
    it('should handle empty token', async () => {
      // Setup: Create credentials file with empty token
      const sudocodeDir = path.join(tempDir, 'sudocode');
      await fs.mkdir(sudocodeDir, { recursive: true });
      const credentialsFile = path.join(sudocodeDir, 'user_credentials.json');
      
      await fs.writeFile(credentialsFile, JSON.stringify({
        claudeCodeOAuthToken: ''
      }, null, 2));
      
      await fs.chmod(credentialsFile, 0o600);
      
      // Execute
      await showAuthStatus({});
      
      // Verify - empty token should be treated as not configured
      const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('Claude Code: ✗ Not configured');
    });
  });
  
  describe('Deployment readiness', () => {
    it('should show ready with at least one credential', async () => {
      // Setup: Create credentials file with one credential
      const sudocodeDir = path.join(tempDir, 'sudocode');
      await fs.mkdir(sudocodeDir, { recursive: true });
      const credentialsFile = path.join(sudocodeDir, 'user_credentials.json');
      
      await fs.writeFile(credentialsFile, JSON.stringify({
        llmKey: 'sk-proj-test123456789'
      }, null, 2));
      
      await fs.chmod(credentialsFile, 0o600);
      
      // Execute
      await showAuthStatus({});
      
      // Verify
      const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('✓ Ready for remote deployment');
      expect(output).toContain('Configured: 1/3 services');
    });
    
    it('should show not ready with no credentials', async () => {
      // No credentials file exists
      
      // Execute
      await showAuthStatus({});
      
      // Verify
      const output = consoleLogSpy.mock.calls.map((call: any[]) => call[0]).join('\n');
      expect(output).toContain('⚠ No credentials configured. Remote deployment unavailable.');
      expect(output).toContain('Configured: 0/3 services');
    });
  });
});
