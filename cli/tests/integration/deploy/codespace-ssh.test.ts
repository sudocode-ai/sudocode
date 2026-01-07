/**
 * Integration tests for codespace-ssh utilities
 *
 * These tests create a real Codespace and verify:
 * - Command execution works end-to-end
 * - Port detection is reliable
 * - Streaming output works
 * - Timeout handling
 *
 * NOTE: These tests require:
 * - GitHub CLI installed and authenticated
 * - A GitHub repository to create Codespace in
 * - Tests will create and delete real Codespaces (costs apply)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  execInCodespace,
  checkPortListening,
  waitForPortListening,
  killProcessOnPort
} from '../../../src/deploy/utils/codespace-ssh.js';
import {
  createCodespace,
  waitForCodespaceReady,
  deleteCodespace,
  getCurrentGitRepo,
  checkGhCliInstalled,
  checkGhAuthenticated
} from '../../../src/deploy/utils/gh-cli.js';

describe('codespace-ssh integration tests', () => {
  let codespaceName: string | null = null;
  const TEST_PORT = 8765;

  beforeAll(async () => {
    // Skip if CI environment without GitHub auth
    if (process.env.CI && !process.env.GITHUB_TOKEN) {
      console.log('Skipping Codespace integration tests in CI without GITHUB_TOKEN');
      return;
    }

    // Verify prerequisites
    try {
      await checkGhCliInstalled();
      await checkGhAuthenticated();
    } catch (error: any) {
      console.warn('Skipping Codespace integration tests:', error.message);
      return;
    }

    // Create test Codespace
    console.log('Creating test Codespace...');
    const repo = await getCurrentGitRepo();
    const codespace = await createCodespace({
      repository: repo,
      machine: 'basicLinux32gb',
      idleTimeout: 30, // 30 minutes
      retentionPeriod: 1 // 1 day
    });

    codespaceName = codespace.name;
    console.log(`Created Codespace: ${codespaceName}`);

    // Wait for it to be ready
    await waitForCodespaceReady(codespaceName, 60); // 2 minutes max
    console.log('Codespace is ready');
  }, 180000); // 3 minute timeout for Codespace creation

  afterAll(async () => {
    // Clean up Codespace
    if (codespaceName) {
      console.log(`Deleting test Codespace: ${codespaceName}`);
      try {
        await deleteCodespace(codespaceName);
        console.log('Test Codespace deleted');
      } catch (error: any) {
        console.error('Failed to delete test Codespace:', error.message);
      }
    }
  }, 30000); // 30 second timeout for cleanup

  it('should execute simple command successfully', async () => {
    if (!codespaceName) {
      console.log('Skipping test: no Codespace available');
      return;
    }

    const output = await execInCodespace(codespaceName, 'echo "Hello from Codespace"', {
      streamOutput: false
    });

    expect(output.trim()).toBe('Hello from Codespace');
  });

  it('should execute command with working directory', async () => {
    if (!codespaceName) {
      console.log('Skipping test: no Codespace available');
      return;
    }

    const output = await execInCodespace(codespaceName, 'pwd', {
      cwd: '/workspaces',
      streamOutput: false
    });

    expect(output.trim()).toBe('/workspaces');
  });

  it('should handle commands with special characters', async () => {
    if (!codespaceName) {
      console.log('Skipping test: no Codespace available');
      return;
    }

    const output = await execInCodespace(
      codespaceName,
      'echo "Test with \\"quotes\\" and $variables"',
      { streamOutput: false }
    );

    expect(output.trim()).toContain('quotes');
  });

  it('should timeout on long-running command', async () => {
    if (!codespaceName) {
      console.log('Skipping test: no Codespace available');
      return;
    }

    await expect(
      execInCodespace(codespaceName, 'sleep 10', {
        timeout: 2000, // 2 second timeout
        streamOutput: false
      })
    ).rejects.toThrow();
  }, 10000);

  it('should detect when port is not listening', async () => {
    if (!codespaceName) {
      console.log('Skipping test: no Codespace available');
      return;
    }

    const isListening = await checkPortListening(codespaceName, TEST_PORT);
    expect(isListening).toBe(false);
  });

  it('should detect when port is listening', async () => {
    if (!codespaceName) {
      console.log('Skipping test: no Codespace available');
      return;
    }

    // Start a simple HTTP server on test port
    await execInCodespace(
      codespaceName,
      `nohup python3 -m http.server ${TEST_PORT} > /dev/null 2>&1 &`,
      { streamOutput: false }
    );

    // Wait a moment for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    const isListening = await checkPortListening(codespaceName, TEST_PORT);
    expect(isListening).toBe(true);
  }, 30000);

  it('should wait for port to become listening', async () => {
    if (!codespaceName) {
      console.log('Skipping test: no Codespace available');
      return;
    }

    // Kill any existing process first
    await killProcessOnPort(codespaceName, TEST_PORT + 1);

    // Start server in background
    execInCodespace(
      codespaceName,
      `sleep 2 && python3 -m http.server ${TEST_PORT + 1} > /dev/null 2>&1`,
      { streamOutput: false }
    ).catch(() => {
      // Ignore errors from background process
    });

    // Wait for it to be listening
    await waitForPortListening(codespaceName, TEST_PORT + 1, 10);

    const isListening = await checkPortListening(codespaceName, TEST_PORT + 1);
    expect(isListening).toBe(true);
  }, 30000);

  it('should timeout if port never opens', async () => {
    if (!codespaceName) {
      console.log('Skipping test: no Codespace available');
      return;
    }

    const unusedPort = TEST_PORT + 100;

    await expect(
      waitForPortListening(codespaceName, unusedPort, 3) // 6 seconds max
    ).rejects.toThrow(/Port.*not listening/);
  }, 15000);

  it('should kill process on port', async () => {
    if (!codespaceName) {
      console.log('Skipping test: no Codespace available');
      return;
    }

    const testPort = TEST_PORT + 2;

    // Start a server
    await execInCodespace(
      codespaceName,
      `nohup python3 -m http.server ${testPort} > /dev/null 2>&1 &`,
      { streamOutput: false }
    );

    // Wait for it to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify it's listening
    let isListening = await checkPortListening(codespaceName, testPort);
    expect(isListening).toBe(true);

    // Kill it
    await killProcessOnPort(codespaceName, testPort);

    // Wait a moment for process to die
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Verify it's no longer listening
    isListening = await checkPortListening(codespaceName, testPort);
    expect(isListening).toBe(false);
  }, 30000);

  it('should not throw when killing non-existent process', async () => {
    if (!codespaceName) {
      console.log('Skipping test: no Codespace available');
      return;
    }

    // Should not throw even if nothing is listening
    await expect(
      killProcessOnPort(codespaceName, TEST_PORT + 999)
    ).resolves.not.toThrow();
  });

  it('should handle streaming output', async () => {
    if (!codespaceName) {
      console.log('Skipping test: no Codespace available');
      return;
    }

    // Capture stdout
    const originalWrite = process.stdout.write;
    let capturedOutput = '';
    process.stdout.write = ((chunk: any): boolean => {
      capturedOutput += chunk.toString();
      return true;
    }) as any;

    try {
      await execInCodespace(
        codespaceName,
        'echo "Line 1" && echo "Line 2"',
        { streamOutput: true }
      );

      expect(capturedOutput).toContain('Line 1');
      expect(capturedOutput).toContain('Line 2');
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});
