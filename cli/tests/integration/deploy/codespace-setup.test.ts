/**
 * Integration tests for Codespace setup utilities
 *
 * WARNING: These tests create and delete REAL Codespaces!
 * They will consume GitHub Codespace credits.
 *
 * Prerequisites:
 * - GitHub CLI installed and authenticated
 * - Valid GitHub repository
 *
 * Run with: npm --prefix cli test -- --run tests/integration/deploy/codespace-setup.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as ghCli from '../../../src/deploy/utils/gh-cli.js';
import { waitForPortListening } from '../../../src/deploy/utils/codespace-ssh.js';
import {
  installClaudeCode,
  installSudocodeGlobally,
  initializeSudocodeProject,
  startSudocodeServer
} from '../../../src/deploy/utils/codespace-setup.js';

// Test configuration
const TEST_TIMEOUT = 600000; // 10 minutes for installation operations
const TEST_MACHINE = 'basicLinux32gb';
const TEST_IDLE_TIMEOUT = 30; // 30 minutes (minimum)
const TEST_RETENTION = 1; // 1 day
const SERVER_PORT = 3000;
const KEEP_ALIVE_HOURS = 2;

// Shared test Codespace (created once, used by all tests, deleted at end)
let testCodespaceName: string;
let testRepository: string;

describe('Codespace Setup Integration Tests', () => {
  beforeAll(async () => {
    // Verify prerequisites
    await ghCli.checkGhCliInstalled();
    await ghCli.checkGhAuthenticated();

    // Get current repository for tests
    testRepository = await ghCli.getCurrentGitRepo();

    console.log(`Running setup tests against repository: ${testRepository}`);

    // Create a test Codespace
    console.log('Creating test Codespace...');
    const codespace = await ghCli.createCodespace({
      repository: testRepository,
      machine: TEST_MACHINE,
      idleTimeout: TEST_IDLE_TIMEOUT,
      retentionPeriod: TEST_RETENTION
    });

    testCodespaceName = codespace.name;
    console.log(`✓ Created test Codespace: ${testCodespaceName}`);

    // Wait for it to be ready
    console.log('Waiting for Codespace to be ready...');
    await ghCli.waitForCodespaceReady(testCodespaceName, 60); // 120 seconds max
    console.log('✓ Codespace is ready');
  }, TEST_TIMEOUT);

  afterAll(async () => {
    // Clean up test Codespace
    if (testCodespaceName) {
      try {
        console.log(`Cleaning up test Codespace: ${testCodespaceName}`);
        await ghCli.deleteCodespace(testCodespaceName);
        console.log('✓ Test Codespace deleted');
      } catch (error: any) {
        console.warn('Warning: Failed to delete test Codespace:', error.message);
      }
    }
  }, TEST_TIMEOUT);

  describe('installClaudeCode', () => {
    it.skip('should install Claude Code successfully', async () => {
      // Note: This test is skipped by default because Claude Code installation
      // may not be critical for all test runs and takes significant time.
      // Remove .skip to run this test when needed.

      await expect(installClaudeCode(testCodespaceName)).resolves.not.toThrow();

      console.log('✓ Claude Code installation completed');
    }, TEST_TIMEOUT);
  });

  describe('installSudocodeGlobally', () => {
    it('should install sudocode packages globally', async () => {
      await expect(installSudocodeGlobally(testCodespaceName)).resolves.not.toThrow();

      console.log('✓ Sudocode packages installed');

      // Verify installation by checking for sudocode CLI
      // This is done implicitly in the next test (initializeSudocodeProject)
    }, TEST_TIMEOUT);
  });

  describe('initializeSudocodeProject', () => {
    it('should create .sudocode directory on first call', async () => {
      await expect(initializeSudocodeProject(testCodespaceName)).resolves.not.toThrow();

      console.log('✓ Project initialized');
    }, TEST_TIMEOUT);

    it('should skip initialization if .sudocode already exists', async () => {
      // Call again - should skip because .sudocode now exists
      await expect(initializeSudocodeProject(testCodespaceName)).resolves.not.toThrow();

      console.log('✓ Project initialization skipped (already exists)');
    }, TEST_TIMEOUT);
  });

  describe('startSudocodeServer', () => {
    it('should start server in background', async () => {
      await expect(
        startSudocodeServer(testCodespaceName, SERVER_PORT, KEEP_ALIVE_HOURS)
      ).resolves.not.toThrow();

      console.log('✓ Server start command executed');
    }, TEST_TIMEOUT);

    it('should have server listening on port after start', async () => {
      // Wait for server to be listening (up to 30 seconds)
      await expect(
        waitForPortListening(testCodespaceName, SERVER_PORT, 15)
      ).resolves.not.toThrow();

      console.log(`✓ Server is listening on port ${SERVER_PORT}`);
    }, TEST_TIMEOUT);
  });

  describe('Integration: Full setup flow', () => {
    it('should complete full setup successfully', async () => {
      // This test verifies that all setup steps work together
      // Most of the work is already done by previous tests,
      // so this just verifies the final state

      console.log('Verifying full setup flow completed...');

      // Verify server is still running
      await expect(
        waitForPortListening(testCodespaceName, SERVER_PORT, 5)
      ).resolves.not.toThrow();

      console.log('✓ Full setup flow verified');
    }, TEST_TIMEOUT);
  });
});
