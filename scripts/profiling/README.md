# npm Install Profiling Script

This directory contains a profiling system for benchmarking `npm install -g sudocode` and capturing detailed timing metrics. It includes support for testing against a local Verdaccio registry to enable realistic profiling without 2FA or publishing to npm.

## Quick Start

### Option 1: Test with Verdaccio (Recommended for Development)

Run the complete end-to-end test workflow:

```bash
./scripts/profiling/test-verdaccio-workflow.sh
```

This automated script will:
1. Start Verdaccio local registry (if not running)
2. Verify authentication
3. Build and publish all packages to Verdaccio
4. Run the profiling benchmark
5. Display results

### Option 2: Manual Profiling

#### Profile from npm Registry

```bash
node scripts/profiling/benchmark.cjs
```

#### Profile from Verdaccio

```bash
NPM_REGISTRY=http://localhost:4873/ SCENARIO=verdaccio node scripts/profiling/benchmark.cjs
```

#### Profile from Local Tarball

```bash
TARBALL_PATH=sudocode-0.1.17.tgz node scripts/profiling/benchmark.cjs
```

## Verdaccio Setup

Verdaccio is a lightweight private npm registry that allows testing npm package installation without 2FA and without publishing to the public registry.

### Why Use Verdaccio?

- **No 2FA required**: Simplifies automated testing
- **Realistic profiling**: Tests actual npm install flow (vs. local tarball)
- **Fast iteration**: Publish and test without waiting for npm registry
- **Safe testing**: Keep development packages private

### Setup Steps

#### 1. Start Verdaccio

```bash
./scripts/profiling/start-verdaccio.sh
```

This will:
- Install Verdaccio globally if needed
- Start Verdaccio on port 4873
- Use config from `verdaccio-config.yaml`

#### 2. Authenticate

**Non-interactive (CI-friendly):**
```bash
./scripts/profiling/setup-verdaccio-auth.sh
```

**Interactive (manual):**
```bash
npm adduser --registry http://localhost:4873/
```

Use any credentials (e.g., `test` / `test` / `test@test.com`). No 2FA required.

#### 3. Publish Packages

```bash
./scripts/profiling/publish-to-verdaccio.sh
```

This will:
- Build all packages
- Publish to Verdaccio in dependency order
- Restore your original npm registry setting

#### 4. Profile Installation

```bash
NPM_REGISTRY=http://localhost:4873/ node scripts/profiling/benchmark.cjs
```

### Stopping Verdaccio

```bash
pkill -f verdaccio
```

## Basic Usage

### Profiling with Different Sources

The benchmark script supports three installation sources:

```bash
# From npm registry (default)
node scripts/profiling/benchmark.cjs

# From Verdaccio
NPM_REGISTRY=http://localhost:4873/ node scripts/profiling/benchmark.cjs

# From local tarball
TARBALL_PATH=sudocode-0.1.17.tgz node scripts/profiling/benchmark.cjs
```

### What the Script Does

1. Run `npm install -g sudocode --timing`
2. Capture total installation time
3. Parse npm's timing logs to extract phase-level metrics
4. Save results to `scripts/profiling/results/benchmark-{scenario}-{timestamp}.json`

### Scenario-Based Benchmarking

Use the `SCENARIO` environment variable to differentiate between test conditions:

```bash
# Fresh install scenario
SCENARIO=fresh-install node scripts/profiling/benchmark.cjs

# Development environment scenario
SCENARIO=dev-environment node scripts/profiling/benchmark.cjs
```

Common scenarios:
- `fresh-install` - Clean system, no cache
- `dev-environment` - Typical developer machine with existing npm cache

## Output Format

The script generates JSON files with the following structure:

```json
{
  "timestamp": "2026-01-02T10:30:00Z",
  "scenario": "fresh-install",
  "environment": {
    "os": "darwin",
    "nodeVersion": "v20.10.0",
    "npmVersion": "10.2.3",
    "macosVersion": "14.0"
  },
  "timing": {
    "total": 45230,
    "phases": {
      "idealTree": 2100,
      "reifyNode": 18500,
      "build": 22400,
      "preinstall": 150,
      "postinstall": 850,
      "finalTree": 800
    }
  }
}
```

### Field Descriptions

**Environment Metadata:**
- `timestamp` - ISO 8601 timestamp of when the benchmark was run
- `scenario` - User-specified scenario type (default: "fresh-install")
- `environment.os` - Operating system platform (e.g., "darwin", "linux", "win32")
- `environment.nodeVersion` - Node.js version (e.g., "v20.10.0")
- `environment.npmVersion` - npm version (e.g., "10.2.3")
- `environment.macosVersion` - macOS version if applicable (e.g., "14.0")
- `environment.registry` - Registry used for installation (e.g., "http://localhost:4873/" or "default")

**Timing Data (all values in milliseconds):**
- `timing.total` - Total installation time measured by the script
- `timing.phases.idealTree` - Time spent resolving the dependency tree
- `timing.phases.reifyNode` - Time spent downloading and extracting packages
- `timing.phases.build` - Time spent building native modules
- `timing.phases.preinstall` - Time spent running preinstall scripts
- `timing.phases.postinstall` - Time spent running postinstall scripts
- `timing.phases.finalTree` - Time spent finalizing the installation

## Requirements

- Node.js (any version compatible with npm)
- npm CLI installed
- macOS (for `macosVersion` field; script works on other platforms but won't capture macOS version)

## Implementation Details

The script uses only Node.js standard library modules:
- `child_process` - For running npm commands
- `fs` - For file operations
- `path` - For path manipulation
- `os` - For system information

No external dependencies are required.

## GitHub Actions Integration

This script is designed to run in GitHub Actions workflows:

```yaml
- name: Run install benchmark
  run: |
    SCENARIO=fresh-install node scripts/profiling/benchmark.cjs
  
- name: Upload benchmark results
  uses: actions/upload-artifact@v3
  with:
    name: benchmark-results
    path: scripts/profiling/results/*.json
```

## Results Directory

Benchmark results are saved to `scripts/profiling/results/` with filenames in the format:

```
benchmark-{scenario}-{timestamp}.json
```

Example: `benchmark-fresh-install-1735819800000.json`

The results directory is gitignored to prevent committing benchmark artifacts to the repository.

## Troubleshooting

### No timing logs found

If the script fails to find npm timing logs, ensure that:
1. npm install actually ran successfully
2. The `~/.npm/_logs/` directory exists
3. npm created timing logs (requires npm 5.1.0+)

The script will continue and provide total time even if timing logs are unavailable.

### Permission errors

If you encounter permission errors during `npm install -g`, you may need to:
1. Run with sudo (not recommended)
2. Configure npm to use a different global prefix
3. Use a Node version manager like nvm

## Module Exports

The script exports the following functions for programmatic use:

```javascript
const { runBenchmark, parseTimingLog, getMacOSVersion, getVersions } = require('./benchmark.cjs');

// Run a complete benchmark
const result = runBenchmark();

// Parse a specific timing log file
const phases = parseTimingLog('/path/to/timing.json');

// Get macOS version (returns null on other platforms)
const macosVersion = getMacOSVersion();

// Get Node.js and npm versions
const { nodeVersion, npmVersion } = getVersions();
```

## File Reference

### Scripts

- **`benchmark.cjs`** - Main profiling script that measures npm install timing
- **`start-verdaccio.sh`** - Start Verdaccio local registry
- **`publish-to-verdaccio.sh`** - Build and publish packages to Verdaccio
- **`test-verdaccio-workflow.sh`** - End-to-end test of complete workflow

### Configuration

- **`verdaccio-config.yaml`** - Verdaccio configuration (disables 2FA)
- **`.gitignore`** - Ignores Verdaccio storage and results

### Directories

- **`results/`** - Benchmark results (JSON files)
- **`storage/`** - Verdaccio package storage (gitignored)

## Environment Variables

The benchmark script supports the following environment variables:

- **`SCENARIO`** - Scenario name for the benchmark (e.g., `fresh-install`, `dev-environment`)
- **`NPM_REGISTRY`** - Custom npm registry URL (e.g., `http://localhost:4873/`)
- **`TARBALL_PATH`** - Path to local tarball file (relative to repo root)

### Examples

```bash
# Verdaccio with custom scenario
NPM_REGISTRY=http://localhost:4873/ SCENARIO=verdaccio-optimized node benchmark.cjs

# Local tarball with scenario
TARBALL_PATH=sudocode-0.1.17.tgz SCENARIO=local-tarball node benchmark.cjs

# Fresh install from npm
SCENARIO=fresh-install node benchmark.cjs
```

## Comparing Results

To compare profiling results between different sources:

```bash
# 1. Profile from local tarball (baseline)
TARBALL_PATH=sudocode-0.1.17.tgz SCENARIO=local-baseline node benchmark.cjs

# 2. Profile from Verdaccio (realistic npm flow)
NPM_REGISTRY=http://localhost:4873/ SCENARIO=verdaccio node benchmark.cjs

# 3. Profile from npm registry (production)
SCENARIO=npm-registry node benchmark.cjs

# 4. Compare results
ls -lh results/
cat results/benchmark-local-baseline-*.json | grep total
cat results/benchmark-verdaccio-*.json | grep total
cat results/benchmark-npm-registry-*.json | grep total
```
