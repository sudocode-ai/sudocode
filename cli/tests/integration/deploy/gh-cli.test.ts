/**
 * Integration tests for GitHub CLI utilities
 *
 * WARNING: These tests create and delete REAL Codespaces!
 * They will consume GitHub Codespace credits.
 *
 * Prerequisites:
 * - GitHub CLI installed and authenticated
 * - Valid GitHub repository
 *
 * Run with: npm --prefix cli test -- --run tests/integration/deploy/gh-cli.test.ts
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import * as ghCli from '../../../src/deploy/utils/gh-cli';

// Test configuration
const TEST_TIMEOUT = 180000; // 3 minutes for Codespace operations
const TEST_MACHINE = 'basicLinux32gb';
const TEST_IDLE_TIMEOUT = 30; // 30 minutes (minimum)
const TEST_RETENTION = 1; // 1 day

// Track created Codespaces for cleanup
const createdCodespaces: string[] = [];

// Test repository (will be determined from current repo)
let testRepository: string;

describe('GitHub CLI Integration Tests', () => {
  beforeAll(async () => {
    // Verify prerequisites
    await ghCli.checkGhCliInstalled();
    await ghCli.checkGhAuthenticated();

    // Get current repository for tests
    testRepository = await ghCli.getCurrentGitRepo();

    console.log(`Running integration tests against repository: ${testRepository}`);
  }, TEST_TIMEOUT);

  afterEach(async () => {
    // Clean up all created Codespaces
    for (const name of createdCodespaces) {
      try {
        console.log(`Cleaning up test Codespace: ${name}`);
        await ghCli.deleteCodespace(name);
        console.log(`✓ Deleted ${name}`);
      } catch (error: any) {
        console.warn(`Warning: Failed to delete Codespace ${name}:`, error.message);
      }
    }

    // Clear the tracking array
    createdCodespaces.length = 0;
  }, TEST_TIMEOUT);

  describe('createCodespace', () => {
    it('should create a real Codespace', async () => {
      const config: ghCli.CodespaceConfig = {
        repository: testRepository,
        machine: TEST_MACHINE,
        idleTimeout: TEST_IDLE_TIMEOUT,
        retentionPeriod: TEST_RETENTION
      };

      const codespace = await ghCli.createCodespace(config);

      // Track for cleanup
      createdCodespaces.push(codespace.name);

      // Verify returned data
      expect(codespace.name).toBeTruthy();
      expect(codespace.name).toMatch(/^[a-z]+-[a-z]+-[a-z0-9]+$/); // GitHub's naming pattern
      expect(codespace.url).toBe(`https://${codespace.name}.github.dev`);
      expect(codespace.state).toBeTruthy();

      console.log(`✓ Created Codespace: ${codespace.name} (state: ${codespace.state})`);
    }, TEST_TIMEOUT);
  });

  describe('waitForCodespaceReady', () => {
    it('should wait until Codespace is Available', async () => {
      // Create Codespace
      const codespace = await ghCli.createCodespace({
        repository: testRepository,
        machine: TEST_MACHINE,
        idleTimeout: TEST_IDLE_TIMEOUT,
        retentionPeriod: TEST_RETENTION
      });

      createdCodespaces.push(codespace.name);

      // Wait for it to be ready (may take 30-60 seconds)
      await ghCli.waitForCodespaceReady(codespace.name, 60); // 120 seconds max

      console.log(`✓ Codespace ${codespace.name} is ready`);
    }, TEST_TIMEOUT);

    it('should timeout if Codespace never becomes ready', async () => {
      // Use a non-existent Codespace name to force timeout
      const fakeName = 'nonexistent-codespace-12345';

      await expect(
        ghCli.waitForCodespaceReady(fakeName, 2) // Only 2 retries (4 seconds)
      ).rejects.toThrow('not found');
    }, 15000);
  });

  describe('listCodespaces', () => {
    it('should list all user Codespaces', async () => {
      // Create a Codespace first
      const codespace = await ghCli.createCodespace({
        repository: testRepository,
        machine: TEST_MACHINE,
        idleTimeout: TEST_IDLE_TIMEOUT,
        retentionPeriod: TEST_RETENTION
      });

      createdCodespaces.push(codespace.name);

      // List all Codespaces
      const codespaces = await ghCli.listCodespaces();

      // Verify our Codespace is in the list
      expect(codespaces).toBeTruthy();
      expect(Array.isArray(codespaces)).toBe(true);

      const found = codespaces.find(cs => cs.name === codespace.name);
      expect(found).toBeTruthy();
      expect(found?.repository).toBeTruthy();
      expect(found?.state).toBeTruthy();
      expect(found?.createdAt).toBeTruthy();

      console.log(`✓ Found ${codespaces.length} Codespace(s)`);
    }, TEST_TIMEOUT);
  });

  describe('deleteCodespace', () => {
    it('should delete an existing Codespace', async () => {
      // Create Codespace
      const codespace = await ghCli.createCodespace({
        repository: testRepository,
        machine: TEST_MACHINE,
        idleTimeout: TEST_IDLE_TIMEOUT,
        retentionPeriod: TEST_RETENTION
      });

      // Delete it
      await ghCli.deleteCodespace(codespace.name);

      // Verify it's gone by listing
      const codespaces = await ghCli.listCodespaces();
      const found = codespaces.find(cs => cs.name === codespace.name);
      expect(found).toBeUndefined();

      console.log(`✓ Deleted Codespace: ${codespace.name}`);

      // Remove from tracking array since we already deleted it
      const index = createdCodespaces.indexOf(codespace.name);
      if (index > -1) {
        createdCodespaces.splice(index, 1);
      }
    }, TEST_TIMEOUT);

    it('should handle deleting non-existent Codespace', async () => {
      const fakeName = 'nonexistent-codespace-12345';

      await expect(
        ghCli.deleteCodespace(fakeName)
      ).rejects.toThrow();
    });
  });

  describe('setPortVisibility', () => {
    it('should set port visibility to public', async () => {
      // Create and wait for Codespace
      const codespace = await ghCli.createCodespace({
        repository: testRepository,
        machine: TEST_MACHINE,
        idleTimeout: TEST_IDLE_TIMEOUT,
        retentionPeriod: TEST_RETENTION
      });

      createdCodespaces.push(codespace.name);
      await ghCli.waitForCodespaceReady(codespace.name, 60);

      // Need to have a process listening on the port first
      // Use SSH to start a simple HTTP server
      const { execInCodespace } = await import('../../../src/deploy/utils/codespace-ssh');

      // Start server on port 3000
      await execInCodespace(
        codespace.name,
        'python3 -m http.server 3000 > /tmp/server.log 2>&1 &',
        { streamOutput: false, timeout: 5000 }
      );

      // Wait a moment for server to start
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Set port visibility to public
      await ghCli.setPortVisibility(codespace.name, 3000, 'public');

      console.log(`✓ Set port 3000 to public on ${codespace.name}`);

      // Note: We can't easily verify visibility changed without parsing gh CLI output
      // The command will throw if it fails, so no error = success
    }, TEST_TIMEOUT);
  });

  describe('getCodespacePortUrl', () => {
    it('should return correct URL format', async () => {
      // Create Codespace to get a real name
      const codespace = await ghCli.createCodespace({
        repository: testRepository,
        machine: TEST_MACHINE,
        idleTimeout: TEST_IDLE_TIMEOUT,
        retentionPeriod: TEST_RETENTION
      });

      createdCodespaces.push(codespace.name);

      // Get port URL
      const url = await ghCli.getCodespacePortUrl(codespace.name, 3000);

      // Verify format
      expect(url).toBe(`https://${codespace.name}-3000.app.github.dev`);
      console.log(`✓ Port URL: ${url}`);
    }, TEST_TIMEOUT);
  });

  describe('waitForUrlAccessible', () => {
    it('should wait for URL to become accessible', async () => {
      // Create and wait for Codespace
      const codespace = await ghCli.createCodespace({
        repository: testRepository,
        machine: TEST_MACHINE,
        idleTimeout: TEST_IDLE_TIMEOUT,
        retentionPeriod: TEST_RETENTION
      });

      createdCodespaces.push(codespace.name);
      await ghCli.waitForCodespaceReady(codespace.name, 60);

      // Import SSH utilities
      const { execInCodespace } = await import('../../../src/deploy/utils/codespace-ssh');

      // Start HTTP server on port 3000
      await execInCodespace(
        codespace.name,
        'python3 -m http.server 3000 > /tmp/server.log 2>&1 &',
        { streamOutput: false, timeout: 5000 }
      );

      // Set port to public
      await ghCli.setPortVisibility(codespace.name, 3000, 'public');

      // Get URL
      const url = await ghCli.getCodespacePortUrl(codespace.name, 3000);

      // Wait for URL to be accessible
      await ghCli.waitForUrlAccessible(url, 15); // 30 seconds max

      console.log(`✓ URL ${url} is accessible`);
    }, TEST_TIMEOUT);

    it('should timeout when URL is not accessible', async () => {
      // Use a URL that will never be accessible
      const fakeUrl = 'https://nonexistent-codespace-12345-9999.app.github.dev';

      await expect(
        ghCli.waitForUrlAccessible(fakeUrl, 2) // Only 2 retries (4 seconds)
      ).rejects.toThrow('not accessible after 4s');
    }, 15000);
  });

  describe('Full workflow', () => {
    it('should create, wait, list, and delete Codespace', async () => {
      // 1. Create
      const codespace = await ghCli.createCodespace({
        repository: testRepository,
        machine: TEST_MACHINE,
        idleTimeout: TEST_IDLE_TIMEOUT,
        retentionPeriod: TEST_RETENTION
      });

      createdCodespaces.push(codespace.name);
      console.log(`✓ Created: ${codespace.name}`);

      // 2. Wait for ready
      await ghCli.waitForCodespaceReady(codespace.name, 60);
      console.log(`✓ Ready: ${codespace.name}`);

      // 3. List and verify
      const codespaces = await ghCli.listCodespaces();
      const found = codespaces.find(cs => cs.name === codespace.name);
      expect(found).toBeTruthy();
      expect(found?.state).toBe('Available');
      console.log(`✓ Listed: ${codespace.name}`);

      // 4. Delete
      await ghCli.deleteCodespace(codespace.name);
      console.log(`✓ Deleted: ${codespace.name}`);

      // Remove from tracking
      const index = createdCodespaces.indexOf(codespace.name);
      if (index > -1) {
        createdCodespaces.splice(index, 1);
      }

      // 5. Verify deletion
      const codespacesAfter = await ghCli.listCodespaces();
      const foundAfter = codespacesAfter.find(cs => cs.name === codespace.name);
      expect(foundAfter).toBeUndefined();
      console.log(`✓ Verified deletion`);
    }, TEST_TIMEOUT);
  });
});
