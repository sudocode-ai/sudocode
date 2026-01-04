#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Get macOS version if running on macOS
 */
function getMacOSVersion() {
  if (os.platform() !== 'darwin') {
    return null;
  }
  try {
    const version = execSync('sw_vers -productVersion', { encoding: 'utf8' }).trim();
    return version;
  } catch (error) {
    console.error('Failed to get macOS version:', error.message);
    return null;
  }
}

/**
 * Get Node.js and npm versions
 */
function getVersions() {
  const nodeVersion = process.version;
  const npmVersion = execSync('npm --version', { encoding: 'utf8' }).trim();
  return { nodeVersion, npmVersion };
}

/**
 * Find the most recent npm timing log
 */
function findLatestTimingLog() {
  const npmLogsDir = path.join(os.homedir(), '.npm', '_logs');

  if (!fs.existsSync(npmLogsDir)) {
    throw new Error(`npm logs directory not found: ${npmLogsDir}`);
  }

  const files = fs.readdirSync(npmLogsDir)
    .filter(f => f.endsWith('-timing.json'))
    .map(f => ({
      name: f,
      path: path.join(npmLogsDir, f),
      mtime: fs.statSync(path.join(npmLogsDir, f)).mtime
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) {
    throw new Error('No npm timing logs found');
  }

  return files[0].path;
}

/**
 * Parse npm timing log and extract phase timings
 */
function parseTimingLog(logPath) {
  const logContent = fs.readFileSync(logPath, 'utf8');
  const timingData = JSON.parse(logContent);

  const phases = {
    idealTree: 0,
    reifyNode: 0,
    build: 0,
    preinstall: 0,
    postinstall: 0,
    finalTree: 0
  };

  // npm timing logs store top-level phase times
  // Use exact key matches to avoid summing nested timers
  if (timingData.timers) {
    // Only use the top-level timer for each phase (exact match)
    phases.idealTree = timingData.timers['idealTree'] || 0;
    phases.reifyNode = timingData.timers['reifyNode'] || 0;
    phases.build = timingData.timers['build'] || 0;
    phases.preinstall = timingData.timers['preinstall'] || 0;
    phases.postinstall = timingData.timers['postinstall'] || 0;
    phases.finalTree = timingData.timers['finalTree'] || 0;

    // Also check for 'reify' which is the parent of reifyNode
    if (!phases.reifyNode && timingData.timers['reify']) {
      phases.reifyNode = timingData.timers['reify'];
    }
  }

  return phases;
}

/**
 * Run npm install and capture timing data
 */
function runBenchmark() {
  const scenario = process.env.SCENARIO || 'fresh-install';
  const tarballPath = process.env.TARBALL_PATH;
  const registry = process.env.NPM_REGISTRY;
  const timestamp = new Date().toISOString();

  console.log(`Running benchmark for scenario: ${scenario}`);

  // Determine what to install
  let installTarget;
  if (tarballPath) {
    // Resolve tarball path relative to repo root (2 levels up from scripts/profiling)
    const repoRoot = path.join(__dirname, '..', '..');
    const resolvedPath = path.resolve(repoRoot, tarballPath);

    if (!fs.existsSync(resolvedPath)) {
      console.error(`Tarball not found: ${resolvedPath}`);
      process.exit(1);
    }

    installTarget = resolvedPath;
    console.log(`Installing from local tarball: ${installTarget}`);
  } else {
    installTarget = 'sudocode';
    if (registry) {
      console.log(`Installing from registry: ${registry}`);
    } else {
      console.log('Installing from npm registry (no TARBALL_PATH or NPM_REGISTRY provided)');
    }
  }

  console.log('Starting npm install...');

  // Measure total installation time
  const startTime = Date.now();

  try {
    // Build npm install command with proper argument array
    const npmArgs = ['install', '-g', installTarget, '--timing'];

    // Add registry flag if specified
    if (registry) {
      npmArgs.push('--registry', registry);
    }

    // Run npm install with timing enabled
    execSync(`npm ${npmArgs.join(' ')}`, {
      stdio: 'inherit',
      encoding: 'utf8',
      shell: true
    });
  } catch (error) {
    console.error('npm install failed:', error.message);
    process.exit(1);
  }

  const endTime = Date.now();
  const totalTime = endTime - startTime;

  console.log(`Installation completed in ${totalTime}ms`);
  console.log('Parsing timing logs...');

  // Find and parse the timing log
  let phases = {};
  try {
    const timingLogPath = findLatestTimingLog();
    console.log(`Found timing log: ${timingLogPath}`);
    phases = parseTimingLog(timingLogPath);
  } catch (error) {
    console.error('Failed to parse timing log:', error.message);
    console.log('Continuing with total time only...');
  }

  // Gather environment metadata
  const { nodeVersion, npmVersion } = getVersions();
  const macosVersion = getMacOSVersion();

  const result = {
    timestamp,
    scenario,
    environment: {
      os: os.platform(),
      nodeVersion,
      npmVersion,
      macosVersion,
      registry: registry || 'default'
    },
    timing: {
      total: totalTime,
      phases
    }
  };

  // Export results to JSON file
  const resultsDir = path.join(__dirname, 'results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const resultFileName = `benchmark-${scenario}-${Date.now()}.json`;
  const resultFilePath = path.join(resultsDir, resultFileName);

  fs.writeFileSync(resultFilePath, JSON.stringify(result, null, 2));
  console.log(`\nResults saved to: ${resultFilePath}`);
  console.log('\nSummary:');
  console.log(JSON.stringify(result, null, 2));

  return result;
}

// Run the benchmark
if (require.main === module) {
  try {
    runBenchmark();
  } catch (error) {
    console.error('Benchmark failed:', error.message);
    process.exit(1);
  }
}

module.exports = { runBenchmark, parseTimingLog, getMacOSVersion, getVersions };
