#!/usr/bin/env node
/**
 * Measure npm install time for sudocode from local tarballs
 *
 * This script runs inside the Docker container to install sudocode from mounted
 * tarballs and measure installation time with detailed breakdown.
 *
 * Enhanced to parse npm verbose output for per-package timing analysis.
 *
 * Usage:
 *   node measure-install.cjs <tarball-directory>
 *
 * Example:
 *   node measure-install.cjs /profiling/tarballs
 *
 * Output:
 *   - JSON object with timing data written to stdout (for machine consumption)
 *   - Human-readable summary written to stderr (for console display)
 *
 * Security:
 *   - Uses spawn instead of exec to prevent shell injection
 *   - Validates all file paths before use
 *   - Only accepts local tarball paths (no network access)
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Parse command line arguments
const tarballDir = process.argv[2];

if (!tarballDir) {
  console.error('Error: Tarball directory path required');
  console.error('Usage: node measure-install.js <tarball-directory>');
  process.exit(1);
}

// Validate tarball directory exists
if (!fs.existsSync(tarballDir)) {
  console.error(`Error: Tarball directory not found: ${tarballDir}`);
  process.exit(1);
}

// Validate it's actually a directory
const stat = fs.statSync(tarballDir);
if (!stat.isDirectory()) {
  console.error(`Error: Path is not a directory: ${tarballDir}`);
  process.exit(1);
}

// Find sudocode tarball
const tarballFiles = fs.readdirSync(tarballDir).filter(f => f.startsWith('sudocode-') && f.endsWith('.tgz'));

if (tarballFiles.length === 0) {
  console.error(`Error: No sudocode tarball found in ${tarballDir}`);
  process.exit(1);
}

// Use the first matching tarball (should only be one)
const sudocodeTarball = path.join(tarballDir, tarballFiles[0]);

// Validate tarball file exists
if (!fs.existsSync(sudocodeTarball)) {
  console.error(`Error: Tarball file not found: ${sudocodeTarball}`);
  process.exit(1);
}

// Extract version from tarball filename
// Format: sudocode-1.1.17.tgz -> 1.1.17
const versionMatch = tarballFiles[0].match(/sudocode-(.+)\.tgz$/);
const version = versionMatch ? versionMatch[1] : 'unknown';

// Get environment info
const { spawnSync } = require('child_process');
const npmVersionResult = spawnSync('npm', ['--version'], { encoding: 'utf8' });
const environment = {
  node: process.version.substring(1), // Remove 'v' prefix
  npm: npmVersionResult.stdout.trim(),
  os: os.platform(),
  arch: os.arch(),
};

console.error(`Installing sudocode@${version} from ${sudocodeTarball}`);
console.error(`Environment: Node ${environment.node}, npm ${environment.npm}, ${environment.os}/${environment.arch}`);
console.error('');

// Data structures for tracking timing
const packageTimings = {};
const phaseTimings = {
  resolve: 0,
  fetch: 0,
  build: 0,
  postinstall: 0,
};

// Track current operation for timing
let currentOperation = null;
let currentPackage = null;
let operationStartTime = null;

// Measure installation time
const startTime = Date.now();
let installStartTime = null;
let gypStartTime = null;

// Buffer for npm output
let outputBuffer = '';

console.error('Starting npm install with verbose logging...');
console.error('');

// Install globally with verbose logging to capture detailed events
const npmProcess = spawn(
  'npm',
  [
    'install',
    '-g',
    sudocodeTarball,
    '--loglevel=silly',
    '--timing',
  ],
  {
    env: {
      ...process.env,
    }
  }
);

// Parse npm output line by line
npmProcess.stdout.on('data', (data) => {
  outputBuffer += data.toString();
  processOutputBuffer();
});

npmProcess.stderr.on('data', (data) => {
  outputBuffer += data.toString();
  processOutputBuffer();
});

function processOutputBuffer() {
  let lines = outputBuffer.split('\n');
  outputBuffer = lines.pop(); // Keep incomplete line in buffer

  lines.forEach(line => {
    const now = Date.now();

    // Parse npm timing messages
    // Format: "npm timing <phase>:<subphase> Completed in <time>ms"

    // Track idealTree (dependency resolution) phase
    if (line.includes('npm timing idealTree:')) {
      const match = line.match(/npm timing idealTree:([^\s]+)\s+Completed in (\d+)ms/);
      if (match) {
        const phase = match[1];
        const duration = parseInt(match[2], 10);
        phaseTimings.resolve += duration;
      }
    }

    // Track reifyNode (package installation) per-package
    else if (line.includes('npm timing reifyNode:')) {
      // Format: "npm timing reifyNode:node_modules/<package> Completed in <time>ms"
      const match = line.match(/npm timing reifyNode:node_modules\/([^\s]+)\s+Completed in (\d+)ms/);
      if (match) {
        const pkgName = match[1].replace(/\/node_modules\//g, '/'); // Normalize nested paths
        const duration = parseInt(match[2], 10);
        if (!packageTimings[pkgName]) {
          packageTimings[pkgName] = { total: 0, operations: [] };
        }
        packageTimings[pkgName].total += duration;
        packageTimings[pkgName].operations.push({ type: 'install', duration });
      }
    }

    // Track build:run:install (native module compilation)
    else if (line.includes('npm timing build:run:install:')) {
      // Format: "npm timing build:run:install:node_modules/<package> Completed in <time>ms"
      const match = line.match(/npm timing build:run:install:node_modules\/([^\s]+)\s+Completed in (\d+)ms/);
      if (match) {
        const pkgName = match[1].replace(/\/node_modules\//g, '/'); // Normalize nested paths
        const duration = parseInt(match[2], 10);
        phaseTimings.build += duration;
        if (!packageTimings[pkgName]) {
          packageTimings[pkgName] = { total: 0, operations: [] };
        }
        packageTimings[pkgName].total += duration;
        packageTimings[pkgName].operations.push({ type: 'build', duration });
      }
    }

    // Track build:run:postinstall (postinstall scripts)
    else if (line.includes('npm timing build:run:postinstall:')) {
      // Format: "npm timing build:run:postinstall:node_modules/<package> Completed in <time>ms"
      const match = line.match(/npm timing build:run:postinstall:node_modules\/([^\s]+)\s+Completed in (\d+)ms/);
      if (match) {
        const pkgName = match[1].replace(/\/node_modules\//g, '/'); // Normalize nested paths
        const duration = parseInt(match[2], 10);
        phaseTimings.postinstall += duration;
        if (!packageTimings[pkgName]) {
          packageTimings[pkgName] = { total: 0, operations: [] };
        }
        packageTimings[pkgName].total += duration;
        packageTimings[pkgName].operations.push({ type: 'postinstall', duration });
      }
    }

    // Track overall phases
    else if (line.includes('npm timing reify:unpack Completed in')) {
      const match = line.match(/npm timing reify:unpack Completed in (\d+)ms/);
      if (match) {
        phaseTimings.fetch += parseInt(match[1], 10);
      }
    }
  });
}

npmProcess.on('close', (exitCode) => {
  const endTime = Date.now();
  const totalTime = endTime - startTime;

  if (exitCode !== 0) {
    console.error('');
    console.error('Error: npm install failed');
    console.error(`Exit code: ${exitCode}`);
    process.exit(1);
  }

  console.error('');
  console.error(`✓ Installation completed in ${(totalTime / 1000).toFixed(2)}s`);
  console.error('');

  // Calculate top bottlenecks
  const bottlenecks = Object.entries(packageTimings)
    .map(([pkg, data]) => ({
      package: pkg,
      time: data.total,
      percentage: (data.total / totalTime) * 100,
      operations: data.operations
    }))
    .filter(b => b.time > 1000) // Only include packages taking >1s
    .sort((a, b) => b.time - a.time)
    .slice(0, 10); // Top 10

  // Build result object
  const result = {
    timestamp: new Date().toISOString(),
    version: version,
    environment: environment,
    timing: {
      total: totalTime,
      phases: phaseTimings,
      packages: packageTimings,
    },
    bottlenecks: bottlenecks,
  };

  // Output JSON to stdout
  console.log(JSON.stringify(result, null, 2));

  // Human-readable summary to stderr
  console.error('');
  console.error('========================================');
  console.error('Profiling Summary');
  console.error('========================================');
  console.error('');
  console.error(`Total install time: ${(totalTime / 1000).toFixed(1)}s`);
  console.error('');

  if (phaseTimings.resolve > 0 || phaseTimings.fetch > 0 || phaseTimings.build > 0 || phaseTimings.postinstall > 0) {
    console.error('Phase breakdown:');
    const totalPhaseTime = Object.values(phaseTimings).reduce((a, b) => a + b, 0);
    if (phaseTimings.resolve > 0) {
      const pct = ((phaseTimings.resolve / totalTime) * 100).toFixed(1);
      console.error(`  Resolve:     ${(phaseTimings.resolve / 1000).toFixed(1)}s (${pct}%)`);
    }
    if (phaseTimings.fetch > 0) {
      const pct = ((phaseTimings.fetch / totalTime) * 100).toFixed(1);
      console.error(`  Fetch:       ${(phaseTimings.fetch / 1000).toFixed(1)}s (${pct}%)`);
    }
    if (phaseTimings.build > 0) {
      const pct = ((phaseTimings.build / totalTime) * 100).toFixed(1);
      console.error(`  Build:       ${(phaseTimings.build / 1000).toFixed(1)}s (${pct}%)`);
    }
    if (phaseTimings.postinstall > 0) {
      const pct = ((phaseTimings.postinstall / totalTime) * 100).toFixed(1);
      console.error(`  Postinstall: ${(phaseTimings.postinstall / 1000).toFixed(1)}s (${pct}%)`);
    }
    console.error('');
  }

  if (bottlenecks.length > 0) {
    console.error('Top bottlenecks:');
    bottlenecks.forEach((b, i) => {
      console.error(`  ${i + 1}. ${b.package}: ${(b.time / 1000).toFixed(1)}s (${b.percentage.toFixed(1)}%)`);
    });
    console.error('');
  } else {
    console.error('No significant per-package bottlenecks detected (all packages <1s)');
    console.error('');
  }

  if (bottlenecks.length === 0 && Object.values(phaseTimings).every(t => t === 0)) {
    console.error('Note: Detailed timing breakdown not available from npm output.');
    console.error('Only total install time was measured.');
    console.error('');
  }

  process.exit(0);
});
