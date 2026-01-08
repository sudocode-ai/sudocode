/**
 * Integration test for full sudocode server deployment with port forwarding
 *
 * WARNING: This test creates and deletes a REAL Codespace!
 * It will consume GitHub Codespace credits.
 *
 * This test validates the complete deployment workflow:
 * 1. Create Codespace
 * 2. Install sudocode globally
 * 3. Initialize sudocode project
 * 4. Start sudocode server
 * 5. Make port public
 * 6. Verify server is accessible via public URL
 * 7. Verify sudocode server health endpoint
 *
 * Prerequisites:
 * - GitHub CLI installed and authenticated
 * - Valid GitHub repository
 *
 * Run with: npm --prefix cli test -- --run tests/integration/deploy/full-deployment.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as ghCli from '../../../src/deploy/utils/gh-cli.js';
import { waitForPortListening } from '../../../src/deploy/utils/codespace-ssh.js';
import {
  installSudocodeGlobally,
  initializeSudocodeProject,
  startSudocodeServer
} from '../../../src/deploy/utils/codespace-setup.js';

// Test configuration
const TEST_TIMEOUT = 600000; // 10 minutes for full deployment
const TEST_MACHINE = 'basicLinux32gb';
const TEST_IDLE_TIMEOUT = 30; // 30 minutes (minimum)
const TEST_RETENTION = 1; // 1 day
const SERVER_PORT = 3000;
const KEEP_ALIVE_HOURS = 2;

// Shared test Codespace
let testCodespaceName: string;
let testRepository: string;
let testWorkspaceDir: string;

describe('Full Sudocode Server Deployment', () => {
  beforeAll(async () => {
    // Verify prerequisites
    await ghCli.checkGhCliInstalled();
    await ghCli.checkGhAuthenticated();

    // Get current repository
    testRepository = await ghCli.getCurrentGitRepo();
    const workspaceName = testRepository.split('/')[1];
    testWorkspaceDir = `/workspaces/${workspaceName}`;

    console.log(`Testing against repository: ${testRepository}`);
    console.log(`Workspace directory: ${testWorkspaceDir}`);

    // Create test Codespace
    console.log('Creating test Codespace...');
    const codespace = await ghCli.createCodespace({
      repository: testRepository,
      machine: TEST_MACHINE,
      idleTimeout: TEST_IDLE_TIMEOUT,
      retentionPeriod: TEST_RETENTION
    });

    testCodespaceName = codespace.name;
    console.log(`✓ Created test Codespace: ${testCodespaceName}`);

    // Wait for Codespace to be ready
    console.log('Waiting for Codespace to be ready...');
    await ghCli.waitForCodespaceReady(testCodespaceName, 60);
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

  it('should deploy sudocode server and access via public URL', async () => {
    // Step 1: Install sudocode globally
    console.log('Installing sudocode globally...');
    await installSudocodeGlobally(testCodespaceName, testWorkspaceDir);
    console.log('✓ Sudocode installed');

    // Step 2: Initialize sudocode project
    console.log('Initializing sudocode project...');
    await initializeSudocodeProject(testCodespaceName, testWorkspaceDir);
    console.log('✓ Project initialized');

    // Step 3: Start sudocode server
    console.log('Starting sudocode server...');
    await startSudocodeServer(testCodespaceName, SERVER_PORT, KEEP_ALIVE_HOURS, testWorkspaceDir);
    console.log('✓ Server start command executed');

    // Step 4: Wait for server to be listening on port
    console.log(`Waiting for server to listen on port ${SERVER_PORT}...`);
    await waitForPortListening(testCodespaceName, SERVER_PORT, 15);
    console.log(`✓ Server is listening on port ${SERVER_PORT}`);

    // Step 5: Make port public
    console.log('Making port public...');
    await ghCli.setPortVisibility(testCodespaceName, SERVER_PORT, 'public');
    console.log('✓ Port is now public');

    // Step 6: Get public URL
    const url = await ghCli.getCodespacePortUrl(testCodespaceName, SERVER_PORT);
    console.log(`✓ Public URL: ${url}`);

    // Step 7: Wait for URL to be accessible
    console.log('Waiting for URL to be accessible...');
    await ghCli.waitForUrlAccessible(url, 15);
    console.log('✓ URL is accessible');

    // Step 8: Verify sudocode server health endpoint
    console.log('Verifying sudocode server health endpoint...');
    const healthUrl = `${url}/api/health`;
    const response = await fetch(healthUrl);

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);

    const healthData = await response.json();
    expect(healthData).toHaveProperty('status');
    expect(healthData.status).toBe('ok');

    console.log('✓ Sudocode server health check passed');
    console.log(`✓ Full deployment successful - server accessible at ${url}`);
  }, TEST_TIMEOUT);
});
