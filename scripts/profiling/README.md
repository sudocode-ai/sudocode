# npm Install Profiling Script

This directory contains a profiling system for benchmarking `npm install -g sudocode` and capturing detailed timing metrics using tarball-based installation.

## Quick Start

### Local Profiling

Profile a local tarball build:

```bash
# 1. Build and create tarball
cd sudocode
npm pack
cd ..

# 2. Run profiling
TARBALL_PATH=sudocode/sudocode-0.1.17.tgz node scripts/profiling/benchmark.cjs
```

### From npm Registry

Profile the published package:

```bash
node scripts/profiling/benchmark.cjs
```

## Why Tarball-Based Profiling?

We use tarballs created with `npm pack` instead of a local npm registry (like Verdaccio) because:

1. **Simplicity**: No need to run and manage a separate registry server
2. **Accuracy**: Tarballs represent the exact package structure users receive from npm
3. **CI-Friendly**: Easy to integrate into GitHub Actions without additional services
4. **No Authentication**: No 2FA or authentication configuration needed
5. **Reproducible**: Same tarball can be profiled multiple times consistently

The only difference from a real npm install is network latency, which is not a primary concern for our profiling goals (we focus on dependency resolution, native compilation, and script execution time).

## GitHub Actions Integration

The profiling workflow (`.github/workflows/profiling.yml`) runs automated benchmarks using a two-job architecture for clean environment isolation.

### Two-Job Architecture

The workflow uses separate jobs for build and profiling to ensure accurate timing:

**Job 1: Build (Ubuntu runner)**
- Checkout code
- Setup Node.js **without npm cache** (critical for clean environment)
- Install dependencies and build
- Create tarball with `npm pack`
- Upload tarball as GitHub Actions artifact (1-day retention)

**Job 2: Profile (macOS-14 runner)**
- Download tarball artifact from Job 1
- **NO full code checkout** (only sparse checkout of profiling scripts)
- Setup fresh Node.js environment **without npm cache**
- Matrix scenarios: fresh-install, dev-environment
- Clear npm cache (fresh-install) or pre-warm cache (dev-environment)
- Run profiling script on downloaded tarball
- Upload profiling results (90-day retention)
- Generate summary in GitHub Actions UI

### Why Two Jobs?

This architecture prevents npm cache contamination that produces invalid profiling data:

- **Clean environment isolation**: Profile job never sees build node_modules
- **No cache pollution**: Build and profile run on completely separate runners with no cache sharing
- **Accurate timing**: Results reflect real-world installation performance (30-120s, not 1-2s)
- **Cost optimization**: Build on cheaper Ubuntu runner, profile on required macOS runner
- **Prevents impossible results**: Earlier single-job runs showed phases longer than total time

**Critical:** Both jobs must NOT use `cache: 'npm'` in setup-node actions. This was the root cause of artificially fast install times.

### Triggering the Workflow

The workflow runs:
- **Manually**: Via workflow_dispatch
- **Weekly**: Every Sunday at 00:00 UTC
- **On releases**: When version tags (v*.*.*) are pushed

### Workflow Triggers

```yaml
on:
  workflow_dispatch:      # Manual trigger
  schedule:
    - cron: '0 0 * * 0'  # Weekly on Sunday
  push:
    tags:
      - 'v*.*.*'         # On version releases
```

## Basic Usage

### Profiling Different Sources

```bash
# From local tarball (most common)
TARBALL_PATH=sudocode-0.1.17.tgz node scripts/profiling/benchmark.cjs

# From npm registry
node scripts/profiling/benchmark.cjs
```

### What the Script Does

1. Runs `npm install -g sudocode --timing` (or installs from tarball)
2. Captures total installation time
3. Parses npm's timing logs to extract phase-level metrics
4. Saves results to `scripts/profiling/results/benchmark-{scenario}-{timestamp}.json`

### Scenario-Based Benchmarking

Use the `SCENARIO` environment variable to differentiate between test conditions:

```bash
# Fresh install scenario
SCENARIO=fresh-install node scripts/profiling/benchmark.cjs

# Development environment scenario
SCENARIO=dev-environment node scripts/profiling/benchmark.cjs
```

**Common scenarios:**
- `fresh-install` - Clean system with empty npm cache
- `dev-environment` - Typical developer machine with existing npm cache and global packages

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
    "macosVersion": "14.0",
    "registry": "tarball"
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
- `environment.registry` - Installation source ("tarball" or "default" for npm registry)

**Timing Data (all values in milliseconds):**
- `timing.total` - Total installation time measured by the script
- `timing.phases.idealTree` - Time spent resolving the dependency tree
- `timing.phases.reifyNode` - Time spent downloading and extracting packages
- `timing.phases.build` - Time spent building native modules (e.g., better-sqlite3)
- `timing.phases.preinstall` - Time spent running preinstall scripts
- `timing.phases.postinstall` - Time spent running postinstall scripts
- `timing.phases.finalTree` - Time spent finalizing the installation

## Requirements

- Node.js ≥18 (compatible with sudocode)
- npm CLI installed
- macOS (for `macosVersion` field; script works on other platforms but won't capture macOS version)

## Implementation Details

The script uses only Node.js standard library modules:
- `child_process` - For running npm commands
- `fs` - For file operations
- `path` - For path manipulation
- `os` - For system information

No external dependencies are required.

## Results Directory

Benchmark results are saved to `scripts/profiling/results/` with filenames in the format:

```
benchmark-{scenario}-{timestamp}.json
```

Example: `benchmark-fresh-install-1735819800000.json`

The results directory is git-tracked to maintain historical profiling data.

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

### Workspace Contamination

When profiling locally, run from a directory outside the workspace to avoid contamination from workspace `node_modules`:

```bash
cd /tmp
TARBALL_PATH=~/sudocode/sudocode-0.1.17.tgz node ~/sudocode/scripts/profiling/benchmark.cjs
```

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

### Directories

- **`results/`** - Benchmark results (JSON files, git-tracked)

## Environment Variables

The benchmark script supports the following environment variables:

- **`SCENARIO`** - Scenario name for the benchmark (e.g., `fresh-install`, `dev-environment`)
- **`TARBALL_PATH`** - Path to local tarball file (absolute or relative to current directory)

### Examples

```bash
# Local tarball with custom scenario
TARBALL_PATH=sudocode-0.1.17.tgz SCENARIO=local-optimized node benchmark.cjs

# Fresh install from npm registry
SCENARIO=fresh-install node benchmark.cjs

# Dev environment with tarball
TARBALL_PATH=sudocode-0.1.17.tgz SCENARIO=dev-environment node benchmark.cjs
```

## Comparing Results

To compare profiling results between different scenarios:

```bash
# 1. Build tarball
cd sudocode && npm pack && cd ..

# 2. Profile fresh install
TARBALL_PATH=sudocode/sudocode-0.1.17.tgz SCENARIO=fresh-install node scripts/profiling/benchmark.cjs

# 3. Pre-warm cache
npm install -g typescript eslint prettier

# 4. Profile dev environment
TARBALL_PATH=sudocode/sudocode-0.1.17.tgz SCENARIO=dev-environment node scripts/profiling/benchmark.cjs

# 5. Compare results
ls -lh scripts/profiling/results/
cat scripts/profiling/results/benchmark-fresh-install-*.json | grep total
cat scripts/profiling/results/benchmark-dev-environment-*.json | grep total
```

### Interpreting Results

**Expected patterns:**
- **Fresh install**: 30-120 seconds typical (depends on network, CPU for native compilation)
- **Dev environment**: 20-90 seconds typical (cache helps with dependency downloads)
- **Largest phase**: `reifyNode` (download/extract) or `build` (native modules like better-sqlite3)
- **Validation**: `timing.total` should be ≥ sum of major phases

**Red flags (indicates contaminated environment):**
- Total time < 5 seconds (too fast, likely using cached builds)
- `idealTree` > `timing.total` (impossible, indicates timing log mismatch)
- `build` phase < 1 second (better-sqlite3 compilation should take 5-20s)

## Performance Insights

### Phase Breakdown

Typical distribution for sudocode installation:

1. **`reifyNode` (40-60%)**: Downloading and extracting npm packages
   - Affected by: Network speed, package count, npm cache
   - Optimization: Pre-built binaries, smaller dependency tree

2. **`build` (30-50%)**: Native module compilation (better-sqlite3)
   - Affected by: CPU speed, compiler version
   - Optimization: Pre-built binaries for common platforms

3. **`idealTree` (5-10%)**: Dependency resolution
   - Affected by: Dependency complexity, npm version
   - Optimization: Flatter dependency tree, lockfile

4. **`postinstall` (1-5%)**: Post-installation scripts
   - Affected by: Script complexity
   - Optimization: Minimize post-install work

5. **Other phases** (<5%): preinstall, finalTree, linking

### Known Bottlenecks

1. **better-sqlite3 native compilation**: Takes 5-20 seconds on first install
   - Mitigation: Investigate pre-built binaries or alternative SQLite drivers

2. **Monorepo package count**: Installing 6+ packages adds overhead
   - Current approach: Meta-package bundles all dependencies

3. **Network latency**: Fresh installs fetch ~50MB+ of dependencies
   - Less concern for tarball profiling (local file access)

## Related Documentation

- **Spec**: `specs/s-8v6l_npm_installation_profiling_system_for_sudocode.md`
- **Workflow**: `.github/workflows/profiling.yml`
